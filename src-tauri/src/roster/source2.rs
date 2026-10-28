//! Source 2 roster and draft reading shared by the Linux and Windows readers. Never calls code
//! in Dota, injects modules, or writes memory. Field offsets come from the running game's
//! schema; each platform supplies process access and finds the schema classes, entity types
//! and resource service in its own binary format. The small engine ABI in `entities` is
//! validated at runtime and must be rechecked after incompatible updates.
use super::{picks, Context, Player, Snapshot};
use iced_x86::{Decoder, DecoderOptions, Mnemonic, Register};
use std::{
    collections::{BTreeMap, BTreeSet},
    time::{Duration, Instant},
};

pub(crate) type Result<T> = std::result::Result<T, &'static str>;
pub(crate) const BAD: &str = "unsupported";
const STEAM_BASE: u64 = 76561197960265728;
pub(crate) const CLASSES: [&str; 5] = [
    "C_DOTA_PlayerResource",
    "PlayerResourcePlayerData_t",
    "PlayerResourcePlayerTeamData_t",
    "C_DOTAGamerules",
    "C_DOTAGamerulesProxy",
];
pub(crate) const TEAM_CLASSES: [&str; 2] = ["C_DOTA_DataRadiant", "C_DOTA_DataDire"];
pub(crate) const DRAFT_CLASSES: [&str; 2] = ["DataTeamPlayer_t", "C_DOTA_DataNonSpectator"];

pub(crate) trait Memory {
    fn read(&self, address: u64, len: usize) -> Result<Vec<u8>>;
    fn u64(&self, address: u64) -> Result<u64> {
        Ok(u64::from_le_bytes(
            self.read(address, 8)?.try_into().unwrap(),
        ))
    }
    fn u32(&self, address: u64) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.read(address, 4)?.try_into().unwrap(),
        ))
    }
    fn i32(&self, address: u64) -> Result<i32> {
        Ok(self.u32(address)? as i32)
    }
    fn string(&self, address: u64) -> Result<String> {
        let mut bytes = Vec::new();
        for i in 0..8 {
            let part = self.read(address.checked_add(i * 16).ok_or(BAD)?, 16)?;
            if let Some(end) = part.iter().position(|b| *b == 0) {
                bytes.extend_from_slice(&part[..end]);
                return Ok(String::from_utf8_lossy(&bytes)
                    .chars()
                    .filter(|c| !c.is_control())
                    .collect());
            }
            bytes.extend_from_slice(&part);
        }
        Err(BAD)
    }
}

/// A game process: its memory, and whether it is still the process a session opened.
pub(crate) trait Target: Memory {
    fn alive(&self) -> bool;
}

/// The interface registry behind engine2's `CreateInterface`, the same on Linux and Windows:
/// its first RIP-relative `mov` loads the list head, nodes are `{factory, name, next}`, and the
/// resource service factory is `lea rax, [rip+X]; ret`.
pub(crate) fn resource_service(memory: &impl Memory, create_interface: u64) -> Result<u64> {
    let code = memory.read(create_interface, 160)?;
    let registry = Decoder::with_ip(64, &code, create_interface, DecoderOptions::NONE)
        .into_iter()
        .find(|i| i.mnemonic() == Mnemonic::Mov && i.is_ip_rel_memory_operand())
        .ok_or(BAD)?
        .ip_rel_memory_address();
    let mut node = memory.u64(registry)?;
    let mut seen = BTreeSet::new();
    while node != 0 && seen.len() < 128 && seen.insert(node) {
        let name = memory.string(memory.u64(node + 8)?)?;
        if name == "GameResourceServiceClientV001" {
            let factory = memory.u64(node)?;
            let code = memory.read(factory, 16)?;
            let mut decoder = Decoder::with_ip(64, &code, factory, DecoderOptions::NONE);
            let lea = decoder.decode();
            if lea.mnemonic() != Mnemonic::Lea
                || lea.op0_register() != Register::RAX
                || !lea.is_ip_rel_memory_operand()
                || decoder.decode().mnemonic() != Mnemonic::Ret
            {
                return Err(BAD);
            }
            return Ok(lea.ip_rel_memory_address());
        }
        node = memory.u64(node + 16)?;
    }
    Err(BAD)
}

#[derive(Debug)]
pub(crate) struct Class {
    pub(crate) size: u64,
    pub(crate) fields: BTreeMap<String, u64>,
}
impl Class {
    pub(crate) fn field(&self, name: &str, width: u64) -> Result<u64> {
        self.fields
            .get(name)
            .copied()
            .filter(|off| off.checked_add(width).is_some_and(|end| end <= self.size))
            .ok_or(BAD)
    }
}
pub(crate) fn class_at(memory: &impl Memory, address: u64) -> Result<Class> {
    if memory.u64(address)? != address {
        return Err(BAD);
    }
    let size = memory.u32(address + 32)? as u64;
    let count = u16::from_le_bytes(memory.read(address + 36, 2)?.try_into().unwrap()) as usize;
    if !(1..=1024).contains(&count) || !(1..=1024 * 1024).contains(&size) {
        return Err(BAD);
    }
    let table = memory.u64(address + 48)?;
    let data = memory.read(table, count * 32)?;
    let mut fields = BTreeMap::new();
    for f in data.chunks_exact(32) {
        let name = memory.string(u64::from_le_bytes(f[..8].try_into().unwrap()))?;
        let offset = u32::from_le_bytes(f[16..20].try_into().unwrap()) as u64;
        if !name.starts_with("m_") || offset >= size || fields.insert(name, offset).is_some() {
            return Err(BAD);
        }
    }
    Ok(Class { size, fields })
}

/// Parse each class from its candidate addresses in the running game. A required class must
/// resolve to exactly one; an optional draft class with several is dropped instead.
pub(crate) fn resolve_classes(
    memory: &impl Memory,
    candidates: BTreeMap<&'static str, Vec<u64>>,
) -> Result<BTreeMap<&'static str, Class>> {
    let mut result = BTreeMap::new();
    for (name, candidates) in candidates {
        let mut found = None;
        let optional = DRAFT_CLASSES.contains(&name);
        for address in candidates {
            match class_at(memory, address) {
                Ok(class) => {
                    if found.is_some() {
                        if optional {
                            found = None;
                            break;
                        }
                        return Err(BAD);
                    }
                    found = Some(class);
                }
                Err("permission") => return Err("permission"),
                _ => {}
            }
        }
        if let Some(class) = found {
            result.insert(name, class);
        } else if !optional {
            return Err(BAD);
        }
    }
    Ok(result)
}

/// Primary virtual tables of the entity classes the reader looks for.
pub(crate) struct EntityTypes {
    pub(crate) resource: BTreeSet<u64>,
    pub(crate) rules: BTreeSet<u64>,
    pub(crate) teams: [BTreeSet<u64>; 2],
}
impl EntityTypes {
    /// From addresses in the module file to addresses in the running game.
    pub(crate) fn rebased(self, base: u64) -> Self {
        let rebase = |set: BTreeSet<u64>| set.into_iter().map(|a| a + base).collect();
        let [radiant, dire] = self.teams;
        Self {
            resource: rebase(self.resource),
            rules: rebase(self.rules),
            teams: [rebase(radiant), rebase(dire)],
        }
    }
    /// Keep the tables whose runtime type name is right; `name_of` reads the platform's RTTI.
    /// Every resource and rules table must check out; team tables that do not are dropped.
    pub(crate) fn verified(mut self, name_of: impl Fn(u64) -> Result<String>) -> Result<Self> {
        for table in self.resource.iter().chain(self.rules.iter()) {
            let name = name_of(*table)?;
            if name != CLASSES[0] && name != CLASSES[4] {
                return Err(BAD);
            }
        }
        for (tables, name) in self.teams.iter_mut().zip(TEAM_CLASSES) {
            tables.retain(|table| name_of(*table).is_ok_and(|actual| actual == name));
        }
        Ok(self)
    }
}

pub(crate) struct DraftLayout {
    vector: u64,
    stride: u64,
    hover: Option<u64>,
    lane: Option<u64>,
}
impl DraftLayout {
    fn new(classes: &BTreeMap<&str, Class>) -> Option<Self> {
        let player = classes.get(DRAFT_CLASSES[0])?;
        let container = classes.get(DRAFT_CLASSES[1])?;
        let team = classes.get(CLASSES[2])?;
        Some(Self {
            vector: container.field("m_vecDataTeam", 16).ok()?,
            stride: player.size,
            hover: player.field("m_nPossibleHeroSelection", 4).ok(),
            lane: team.field("m_eLaneSelectionFlags", 1).ok(),
        })
    }
}
pub(crate) struct Layout {
    player_vector: u64,
    team_vector: u64,
    names: u64,
    pub(crate) player_size: u64,
    pub(crate) team_size: u64,
    pub(crate) steam: u64,
    team: u64,
    pub(crate) hero: u64,
    rules_pointer: u64,
    match_id: u64,
    phase: u64,
    /// Optional: All Pick/Turbo bans (no team).
    pub(crate) bans: Option<u64>,
    draft: Option<DraftLayout>,
    team_slot: Option<u64>,
    rank_tier: Option<u64>,
}
impl Layout {
    pub(crate) fn new(classes: &BTreeMap<&str, Class>) -> Result<Self> {
        let resource = classes.get(CLASSES[0]).ok_or(BAD)?;
        let player = classes.get(CLASSES[1]).ok_or(BAD)?;
        let team = classes.get(CLASSES[2]).ok_or(BAD)?;
        let rules = classes.get(CLASSES[3]).ok_or(BAD)?;
        let proxy = classes.get(CLASSES[4]).ok_or(BAD)?;
        Ok(Self {
            player_vector: resource.field("m_vecPlayerData", 16)?,
            team_vector: resource.field("m_vecPlayerTeamData", 16)?,
            names: resource.field("m_iszName", 64 * 8)?,
            player_size: player.size,
            team_size: team.size,
            steam: player.field("m_iPlayerSteamID", 8)?,
            team: player.field("m_iPlayerTeam", 1)?,
            hero: team.field("m_nSelectedHeroID", 4)?,
            rules_pointer: proxy.field("m_pGameRules", 8)?,
            match_id: rules.field("m_unMatchID64", 8)?,
            phase: rules.field("m_nGameState", 4)?,
            // A missing ban field must not disable roster or picks.
            bans: rules.field("m_vecNewBannedHeroes", 16).ok(),
            draft: DraftLayout::new(classes),
            team_slot: team.field("m_iTeamSlot", 4).ok(),
            // PlayerResourcePlayerData_t schema: m_iRankTier is int32.
            rank_tier: player.field("m_iRankTier", 4).ok(),
        })
    }
}

/// Find the resource, game rules proxy and team data entities. `systems` lists where the
/// resource service may keep its entity system pointer (Linux +0x50; Windows +0x58 from its
/// setter, with +0x50 as a fallback); the first offset whose chunks validate is returned too.
type Entities = (u64, u64, [Option<u64>; 2]);
fn entities(
    memory: &impl Memory,
    service: u64,
    types: &EntityTypes,
    systems: &[u64],
) -> Result<(u64, Entities)> {
    let mut error = BAD;
    for &offset in systems {
        match entities_at(memory, service + offset, types) {
            Ok(found) => return Ok((offset, found)),
            // Prefer the answer of an offset that held a real, still empty, entity system.
            Err(e) if error != "waiting-entities" => error = e,
            Err(_) => {}
        }
    }
    Err(error)
}
fn entities_at(memory: &impl Memory, pointer: u64, types: &EntityTypes) -> Result<Entities> {
    // Observed Source 2 ABI: 32 chunks of 512 identities, 0x70 bytes each (the
    // CEntityIdentity schema size on both systems). Validate every handle before following it.
    let system = memory.u64(pointer)?;
    let chunks = memory.read(system + 0x10, 32 * 8)?;
    let mut resource = None;
    let mut proxy = None;
    let mut teams = [None; 2];
    for (group, ptr) in chunks.chunks_exact(8).enumerate() {
        let chunk = u64::from_le_bytes(ptr.try_into().unwrap());
        if chunk == 0 {
            continue;
        }
        let data = memory.read(chunk, 512 * 0x70)?;
        for (slot, identity) in data.chunks_exact(0x70).enumerate() {
            let instance = u64::from_le_bytes(identity[..8].try_into().unwrap());
            let handle = u32::from_le_bytes(identity[16..20].try_into().unwrap());
            if instance == 0 || handle & 0x7fff != (group * 512 + slot) as u32 {
                continue;
            }
            let Ok(vtable) = memory.u64(instance) else {
                continue;
            };
            if types.resource.contains(&vtable) && resource.replace(instance).is_some() {
                return Err(BAD);
            }
            if types.rules.contains(&vtable) && proxy.replace(instance).is_some() {
                return Err(BAD);
            }
            for (index, tables) in types.teams.iter().enumerate() {
                if tables.contains(&vtable) && teams[index].replace(instance).is_some() {
                    return Err(BAD);
                }
            }
        }
    }
    Ok((
        resource.ok_or("waiting-entities")?,
        proxy.ok_or("waiting-entities")?,
        teams,
    ))
}
fn vector(memory: &impl Memory, address: u64, stride: u64) -> Result<(u32, u64)> {
    let count = memory.u32(address)?;
    let pointer = memory.u64(address + 8)?;
    if count == 0
        || count > 64
        || stride == 0
        || stride > 16384
        || pointer < 0x10000
        || pointer
            .checked_add(count as u64 * stride)
            .is_none_or(|end| end >= 0x800000000000)
    {
        return Err("incomplete");
    }
    Ok((count, pointer))
}
/// CNetworkUtlVectorBase<HeroID_t>: int count, then a pointer to u32 hero IDs.
/// Unlike player vectors, an empty ban list is valid.
fn bans(memory: &impl Memory, layout: &Layout, rules: u64) -> Result<Vec<u32>> {
    let Some(field) = layout.bans else {
        return Ok(Vec::new());
    };
    let count = memory.u32(rules + field)?;
    if count == 0 {
        return Ok(Vec::new());
    }
    if count > picks::MAX_BANS as u32 {
        return Err(picks::incomplete("ban count over limit"));
    }
    let data = memory.read(memory.u64(rules + field + 8)?, count as usize * 4)?;
    Ok(data
        .chunks_exact(4)
        .map(|v| u32::from_le_bytes(v.try_into().unwrap()))
        .collect())
}
fn read_roster(
    memory: &impl Memory,
    layout: &Layout,
    resource: u64,
    proxy: u64,
    ctx: &Context,
) -> Result<Snapshot> {
    let rules = memory.u64(proxy + layout.rules_pointer)?;
    let match_id = memory.u64(rules + layout.match_id)?;
    let phase = memory.u32(rules + layout.phase)?;
    // Dota game states: strategy=3, pregame=4, playing=5, team showcase=8.
    if match_id != ctx.match_id || ![3, 4, 5, 8].contains(&phase) {
        return Err("match-mismatch");
    }
    let pv = vector(memory, resource + layout.player_vector, layout.player_size)?;
    let tv = vector(memory, resource + layout.team_vector, layout.team_size)?;
    let mut players = Vec::new();
    for index in 0..pv.0 {
        let player = pv.1 + index as u64 * layout.player_size;
        let team = memory.read(player + layout.team, 1)?[0];
        if ![2, 3].contains(&team) {
            continue;
        }
        if index >= tv.0 {
            return Err("incomplete");
        }
        let steam = memory.u64(player + layout.steam)?;
        let Some(account_id) = steam
            .checked_sub(STEAM_BASE)
            .and_then(|id| u32::try_from(id).ok())
            .filter(|id| *id > 0)
        else {
            return Err("incomplete");
        };
        let hero = memory.u32(tv.1 + index as u64 * layout.team_size + layout.hero)?;
        let name = memory
            .u64(resource + layout.names + index as u64 * 8)
            .and_then(|p| memory.string(p))
            .unwrap_or_default();
        players.push(Player {
            index,
            account_id,
            team,
            hero,
            name,
            rank_tier: layout
                .rank_tier
                .and_then(|field| memory.i32(player + field).ok())
                .filter(|tier| (10..=80).contains(tier)),
        });
    }
    // Reject loading/teardown and vector reallocations that occurred during reading.
    // A changed read is retried next tick; "unavailable" would drop the session.
    if memory.u64(proxy + layout.rules_pointer)? != rules
        || memory.u64(rules + layout.match_id)? != match_id
        || memory.u32(rules + layout.phase)? != phase
        || vector(memory, resource + layout.player_vector, layout.player_size)? != pv
        || vector(memory, resource + layout.team_vector, layout.team_size)? != tv
    {
        return Err("retrying");
    }
    let snapshot = Snapshot { match_id, players };
    if !snapshot.matches(ctx) {
        return Err("incomplete");
    }
    Ok(snapshot)
}

/// Read only draft fields and teams. Identity/name fields are deliberately not read.
fn read_draft(
    memory: &impl Memory,
    layout: &Layout,
    resource: u64,
    proxy: u64,
    ctx: &picks::Context,
    teams: &[Option<u64>; 2],
) -> Result<picks::Snapshot> {
    let rules = memory.u64(proxy + layout.rules_pointer)?;
    let match_id = memory.u64(rules + layout.match_id)?;
    let phase = memory.u32(rules + layout.phase)?;
    if match_id != ctx.match_id || Some(phase) != picks::phase_number(&ctx.phase) {
        return Err("match-mismatch");
    }
    let pv = vector(memory, resource + layout.player_vector, layout.player_size)
        .map_err(|e| picks::tag(e, "player vector"))?;
    let tv = vector(memory, resource + layout.team_vector, layout.team_size)
        .map_err(|e| picks::tag(e, "team vector"))?;
    let mut selected = Vec::new();
    let mut hovers = Vec::new();
    let mut lanes = Vec::new();
    let mut slots = Vec::new();
    let vectors = teams.map(|entity| {
        layout.draft.as_ref().and_then(|draft| {
            entity.and_then(|entity| vector(memory, entity + draft.vector, draft.stride).ok())
        })
    });
    let mut team_counts = [0u32; 2];
    for slot in 0..pv.0 {
        let team = memory.read(pv.1 + slot as u64 * layout.player_size + layout.team, 1)?[0];
        if ![2, 3].contains(&team) {
            continue;
        }
        team_counts[(team - 2) as usize] += 1;
        if team_counts[(team - 2) as usize] > 5 || slot >= tv.0 {
            return Err(picks::incomplete("player rows exceed team data"));
        }
        let row = tv.1 + slot as u64 * layout.team_size;
        let hero = memory.u32(row + layout.hero)?;
        let index = layout
            .team_slot
            .map(|field| memory.u32(row + field))
            .transpose()?
            .filter(|index| *index < 5);
        slots.push(picks::Slot {
            slot,
            team,
            team_slot: index.map(|index| index as i32).unwrap_or(-1),
        });
        if let (Some(draft), Some((count, pointer)), Some(index)) =
            (&layout.draft, vectors[(team - 2) as usize], index)
        {
            if index < count {
                if let Some(field) = draft.hover {
                    let hover = memory.u32(pointer + index as u64 * draft.stride + field)?;
                    if (1..=1000).contains(&hover) && hover != hero {
                        hovers.push(picks::Pick {
                            slot,
                            team,
                            hero: hover,
                        });
                    }
                }
            }
        }
        // The lane lives in the team data row, which every player has; only the own side
        // has draft data, which here just confirms the layout. Enemies get roles too.
        if let (Some(field), Some(_), true) = (
            layout.draft.as_ref().and_then(|draft| draft.lane),
            index,
            vectors.iter().any(Option::is_some),
        ) {
            let flags = memory.read(row + field, 1)?[0];
            if flags > 0 && flags & !31 == 0 {
                lanes.push(picks::Lane { slot, team, flags });
            }
        }
        if hero == 0 || hero == u32::MAX {
            continue;
        }
        // While a pick is being locked the field briefly holds a non-hero value
        // (live 14.10: "pick values" rejected the whole draft). Not a pick yet.
        if !(1..=1000).contains(&hero) {
            picks::note(format!("slot {slot} hero value {hero:#x} skipped"));
            continue;
        }
        selected.push(picks::Pick { slot, team, hero });
    }
    let mut banned = bans(memory, layout, rules)?;
    // A confirmed pick outranks the ban list (seen in a bot lobby): keep the pick.
    banned.retain(|hero| {
        let picked = selected.iter().any(|pick| pick.hero == *hero);
        if picked {
            picks::note(format!("picked hero {hero} was in the ban list"));
        }
        !picked
    });
    hovers.retain(|hover| !selected.iter().any(|pick| pick.hero == hover.hero));
    if let Some(draft) = &layout.draft {
        for (entity, before) in teams.iter().zip(vectors) {
            if let (Some(entity), Some(before)) = (entity, before) {
                if vector(memory, entity + draft.vector, draft.stride)
                    .map_err(|e| picks::tag(e, "draft team vector emptied"))?
                    != before
                {
                    return Err("retrying");
                }
            }
        }
    }
    if memory.u64(proxy + layout.rules_pointer)? != rules
        || memory.u64(rules + layout.match_id)? != match_id
        || memory.u32(rules + layout.phase)? != phase
        || vector(memory, resource + layout.player_vector, layout.player_size)? != pv
        || vector(memory, resource + layout.team_vector, layout.team_size)? != tv
    {
        return Err("retrying");
    }
    let snapshot = picks::Snapshot {
        match_id,
        phase,
        picks: selected,
        bans: banned,
        hovers,
        lanes,
        slots,
    };
    if let Some(reason) = snapshot.mismatch(ctx) {
        return Err(picks::incomplete(reason));
    }
    Ok(snapshot)
}

fn read_stable_draft(
    memory: &impl Memory,
    layout: &Layout,
    resource: u64,
    proxy: u64,
    ctx: &picks::Context,
    teams: &[Option<u64>; 2],
) -> Result<picks::Snapshot> {
    let first = read_draft(memory, layout, resource, proxy, ctx, teams)?;
    let second = read_draft(memory, layout, resource, proxy, ctx, teams)?;
    if first != second {
        return Err("retrying");
    }
    Ok(second)
}

pub(crate) struct Session<T: Target> {
    memory: T,
    service: u64,
    layout: Layout,
    types: EntityTypes,
    systems: Vec<u64>,
}
impl<T: Target> Session<T> {
    pub(crate) fn new(
        memory: T,
        service: u64,
        layout: Layout,
        types: EntityTypes,
        systems: &[u64],
    ) -> Result<Self> {
        if !memory.alive() {
            return Err("not-running");
        }
        Ok(Self {
            memory,
            service,
            layout,
            types,
            systems: systems.to_vec(),
        })
    }
    fn entities(&mut self) -> Result<Entities> {
        let (offset, found) = entities(&self.memory, self.service, &self.types, &self.systems)?;
        // Once an offset has validated, keep reading only that one.
        self.systems = vec![offset];
        Ok(found)
    }
    pub(crate) fn poll_draft(&mut self, ctx: &picks::Context) -> Result<picks::Snapshot> {
        if !self.memory.alive() {
            return Err("not-running");
        }
        let (resource, proxy, teams) = self.entities()?;
        let snapshot = read_stable_draft(&self.memory, &self.layout, resource, proxy, ctx, &teams)?;
        if !self.memory.alive() {
            return Err("unavailable");
        }
        Ok(snapshot)
    }
    pub(crate) fn poll(&mut self, ctx: &Context) -> Result<Snapshot> {
        if !self.memory.alive() {
            return Err("not-running");
        }
        let (resource, proxy, _) = self.entities()?;
        let first = read_roster(&self.memory, &self.layout, resource, proxy, ctx)?;
        let second = read_roster(&self.memory, &self.layout, resource, proxy, ctx)?;
        if !self.memory.alive() {
            return Err("unavailable");
        }
        // Two consecutive identity reads protect against hero swaps/slot changes;
        // a pick landing between them is retried, not treated as a lost process.
        if first
            .players
            .iter()
            .map(|p| (p.index, p.account_id, p.team, p.hero))
            .ne(second
                .players
                .iter()
                .map(|p| (p.index, p.account_id, p.team, p.hero)))
        {
            return Err("retrying");
        }
        Ok(second)
    }
}

/// How a platform opens a session on the running game.
pub(crate) trait Platform {
    type Process: Target;
    fn connect() -> Result<Session<Self::Process>>;
}
pub(crate) struct Provider<P: Platform> {
    session: Option<Session<P::Process>>,
    retry_after: Option<Instant>,
    last_error: Option<&'static str>,
}
impl<P: Platform> Default for Provider<P> {
    fn default() -> Self {
        Self {
            session: None,
            retry_after: None,
            last_error: None,
        }
    }
}
impl<P: Platform> Provider<P> {
    pub(crate) fn clear(&mut self) {
        self.session = None;
        self.retry_after = None;
        self.last_error = None;
    }
    fn connect(&mut self) -> Result<()> {
        if self.session.is_none() {
            if self.retry_after.is_some_and(|t| Instant::now() < t) {
                return Err(self.last_error.unwrap_or("retrying"));
            }
            match P::connect() {
                Ok(session) => {
                    self.session = Some(session);
                    self.retry_after = None;
                    self.last_error = None;
                }
                Err(error) => {
                    self.retry_after = Some(Instant::now() + Duration::from_secs(5));
                    self.last_error = Some(error);
                    return Err(error);
                }
            }
        }
        Ok(())
    }
    fn invalidate<T>(&mut self, result: &Result<T>) {
        if matches!(
            result,
            Err("not-running" | "permission" | "unsupported" | "unavailable")
        ) {
            self.session = None;
            self.retry_after = Some(Instant::now() + Duration::from_secs(5));
            self.last_error = result.as_ref().err().copied();
        }
    }
    pub(crate) fn poll(&mut self, ctx: &Context) -> Result<Snapshot> {
        self.connect()?;
        let result = self.session.as_mut().unwrap().poll(ctx);
        self.invalidate(&result);
        result
    }
    pub(crate) fn poll_draft(&mut self, ctx: &picks::Context) -> Result<picks::Snapshot> {
        self.connect()?;
        let result = self.session.as_mut().unwrap().poll_draft(ctx);
        self.invalidate(&result);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    struct Fixture {
        bytes: Vec<u8>,
        swap_match: Cell<bool>,
        match_reads: Cell<u32>,
    }
    impl Fixture {
        fn put(&mut self, at: usize, data: &[u8]) {
            self.bytes[at..at + data.len()].copy_from_slice(data);
        }
        fn q(&mut self, at: usize, value: u64) {
            self.put(at, &value.to_le_bytes());
        }
        fn d(&mut self, at: usize, value: u32) {
            self.put(at, &value.to_le_bytes());
        }
    }
    impl Memory for Fixture {
        fn read(&self, address: u64, len: usize) -> Result<Vec<u8>> {
            if address == 0x5020 {
                let reads = self.match_reads.get();
                self.match_reads.set(reads + 1);
                if self.swap_match.get() && reads > 0 {
                    return Ok(124u64.to_le_bytes().to_vec());
                }
            }
            self.bytes
                .get(address as usize..address as usize + len)
                .map(|v| v.to_vec())
                .ok_or("unavailable")
        }
    }
    fn fixture() -> (Fixture, Layout, Context) {
        let mut memory = Fixture {
            bytes: vec![0; 0x20000],
            swap_match: Cell::new(false),
            match_reads: Cell::new(0),
        };
        // Deliberately different offsets/strides from the installed game.
        let layout = Layout {
            player_vector: 0x20,
            team_vector: 0x40,
            names: 0x100,
            player_size: 128,
            team_size: 96,
            steam: 32,
            team: 24,
            hero: 48,
            rules_pointer: 8,
            match_id: 32,
            phase: 16,
            bans: Some(0x40),
            draft: None,
            team_slot: None,
            rank_tier: None,
        };
        memory.q(0x4008, 0x5000);
        memory.q(0x5020, 123);
        memory.d(0x5010, 5);
        memory.d(0x1020, 10);
        memory.q(0x1028, 0x10000);
        memory.d(0x1040, 10);
        memory.q(0x1048, 0x12000);
        for i in 0..10 {
            memory.bytes[0x10000 + i * 128 + 24] = if i < 5 { 2 } else { 3 };
            memory.q(0x10000 + i * 128 + 32, STEAM_BASE + i as u64 + 1);
            memory.d(0x12000 + i * 96 + 48, 20);
            memory.q(0x1100 + i * 8, 0x6000 + i as u64 * 128);
            memory.put(0x6000 + i * 128, "Player\0".as_bytes());
        }
        let ctx = Context {
            match_id: 123,
            account_id: 6,
            team: 3,
            hero: 20,
            phase: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS".into(),
            watching: false,
        };
        (memory, layout, ctx)
    }
    fn draft_fixture() -> (Fixture, Layout, picks::Context) {
        let (mut m, l, _) = fixture();
        m.d(0x5010, 2);
        for i in 0..10 {
            m.q(0x10000 + i * 128 + 32, u64::MAX);
            m.d(
                0x12000 + i * 96 + 48,
                if i == 0 {
                    1
                } else if i == 5 {
                    2
                } else {
                    0
                },
            );
        }
        (
            m,
            l,
            picks::Context {
                match_id: 123,
                phase: "DOTA_GAMERULES_STATE_HERO_SELECTION".into(),
                team: 3,
                hero: None,
            },
        )
    }
    #[test]
    fn reads_optional_medals_from_the_player_schema() {
        let (mut memory, layout, ctx) = fixture();
        let class = |size, fields: &[(&str, u64)]| Class {
            size,
            fields: fields
                .iter()
                .map(|(name, offset)| (name.to_string(), *offset))
                .collect(),
        };
        let mut classes = BTreeMap::from([
            (
                CLASSES[0],
                class(
                    0x400,
                    &[
                        ("m_vecPlayerData", layout.player_vector),
                        ("m_vecPlayerTeamData", layout.team_vector),
                        ("m_iszName", layout.names),
                    ],
                ),
            ),
            (
                CLASSES[1],
                class(
                    layout.player_size,
                    &[
                        ("m_iPlayerSteamID", layout.steam),
                        ("m_iPlayerTeam", layout.team),
                        ("m_iRankTier", 64),
                    ],
                ),
            ),
            (
                CLASSES[2],
                class(layout.team_size, &[("m_nSelectedHeroID", layout.hero)]),
            ),
            (
                CLASSES[3],
                class(
                    0x100,
                    &[
                        ("m_unMatchID64", layout.match_id),
                        ("m_nGameState", layout.phase),
                    ],
                ),
            ),
            (
                CLASSES[4],
                class(16, &[("m_pGameRules", layout.rules_pointer)]),
            ),
        ]);
        let live = serde_json::json!({"mode":"player","matchId":"123",
            "gameState":"DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
            "players":[{"key":"self","team":"dire","accountId":"6","heroId":20,"kills":7}]});
        for (index, value) in [10i32, 54, 80, 0, 9, 81, -1, 310, 75, 33]
            .into_iter()
            .enumerate()
        {
            memory.d(0x10000 + index * 128 + 64, value as u32);
        }
        let read = |classes: &BTreeMap<&str, Class>| {
            read_roster(
                &memory,
                &Layout::new(classes).unwrap(),
                0x1000,
                0x4000,
                &ctx,
            )
            .unwrap()
            .merge(live.clone())
        };
        let out = read(&classes);
        for (index, tier) in [(0, 10), (1, 54), (2, 80), (8, 75), (9, 33)] {
            assert_eq!(out["players"][index]["rankTier"], tier);
        }
        for index in [3, 4, 5, 6, 7] {
            assert!(out["players"][index].get("rankTier").is_none());
        }
        assert_eq!(
            out["players"][5]["kills"], 7,
            "Own GSI stats survive enrichment"
        );
        memory.d(0x10000 + 5 * 128 + 64, 65);
        let out = read_roster(
            &memory,
            &Layout::new(&classes).unwrap(),
            0x1000,
            0x4000,
            &ctx,
        )
        .unwrap()
        .merge(live.clone());
        assert_eq!(
            out["players"][5]["rankTier"], 65,
            "Own medal is enriched too"
        );
        for offset in [None, Some(layout.player_size - 2)] {
            let fields = &mut classes.get_mut(CLASSES[1]).unwrap().fields;
            fields.remove("m_iRankTier");
            if let Some(offset) = offset {
                fields.insert("m_iRankTier".into(), offset);
            }
            let out = read_roster(
                &memory,
                &Layout::new(&classes).unwrap(),
                0x1000,
                0x4000,
                &ctx,
            )
            .unwrap()
            .merge(live.clone());
            assert_eq!(out["players"].as_array().unwrap().len(), 10);
            assert!(out["players"]
                .as_array()
                .unwrap()
                .iter()
                .all(|p| p.get("rankTier").is_none()));
        }
    }
    fn hover_fixture() -> (Fixture, Layout, picks::Context, [Option<u64>; 2]) {
        let (mut m, mut l, c) = draft_fixture();
        l.team_slot = Some(56);
        l.draft = Some(DraftLayout {
            vector: 0x20,
            stride: 128,
            hover: Some(16),
            lane: Some(60),
        });
        for (entity, pointer) in [(0x8000, 0x18000), (0x9000, 0x19000)] {
            m.d(entity + 0x20, 5);
            m.q(entity + 0x28, pointer);
        }
        for slot in 0..10 {
            m.d(0x12000 + slot * 96 + 56, ((slot % 5 + 2) % 5) as u32);
        }
        // Global slot 6 -> Dire team slot 3, not vector entry 6.
        m.d(0x19000 + 3 * 128 + 16, 74);
        m.bytes[0x12000 + 6 * 96 + 60] = 4;
        (m, l, c, [None, Some(0x9000)])
    }
    #[test]
    fn reads_team_hover_and_lane_without_requiring_enemy_data() {
        let (mut m, l, c, mut teams) = hover_fixture();
        let read = |m: &Fixture, teams: &[Option<u64>; 2]| {
            read_stable_draft(m, &l, 0x1000, 0x4000, &c, teams).unwrap()
        };
        let out = read(&m, &teams);
        assert_eq!(
            out.hovers,
            vec![picks::Pick {
                slot: 6,
                team: 3,
                hero: 74
            }]
        );
        assert_eq!(
            out.lanes,
            vec![picks::Lane {
                slot: 6,
                team: 3,
                flags: 4
            }]
        );
        assert_eq!(out.picks.len(), 2);
        assert_eq!(out.slots.len(), 10);
        assert_eq!(
            out.slots[6],
            picks::Slot {
                slot: 6,
                team: 3,
                team_slot: 3
            }
        );
        m.d(0x5040, 1);
        m.q(0x5048, 0x7000);
        m.d(0x7000, 74);
        assert_eq!(
            read(&m, &teams).hovers,
            out.hovers,
            "Keep banned hovers for display only"
        );
        m.d(0x19000 + 3 * 128 + 16, 700);
        m.bytes[0x12000 + 6 * 96 + 60] = 24;
        assert_eq!(
            read(&m, &teams).hovers[0].hero,
            700,
            "HeroID_t must not be truncated to a byte"
        );
        assert_eq!(read(&m, &teams).lanes[0].flags, 24, "Keep multi-role flags");
        teams[0] = Some(0x8000);
        m.d(0x18000 + 3 * 128 + 16, 17);
        assert_eq!(
            read(&m, &teams).hovers[0],
            picks::Pick {
                slot: 1,
                team: 2,
                hero: 17
            }
        );
        assert_eq!(read(&m, &teams).hovers.len(), 2);
    }
    #[test]
    fn reads_enemy_roles_without_their_draft_data() {
        // Live 23.10: only the own side's draft vector exists, but every player's team data
        // row carries the assigned role-queue lane, enemies included.
        let (mut m, l, c, teams) = hover_fixture();
        m.bytes[0x12000 + 96 + 60] = 16;
        let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap();
        assert_eq!(
            out.lanes,
            vec![
                picks::Lane {
                    slot: 1,
                    team: 2,
                    flags: 16
                },
                picks::Lane {
                    slot: 6,
                    team: 3,
                    flags: 4
                }
            ]
        );
        assert!(out.hovers.iter().all(|hover| hover.team == 3));
    }
    #[test]
    fn ignores_invalid_hovers_and_team_slots_without_losing_picks() {
        for hero in [0, u32::MAX, 1001, 1, 2] {
            let (mut m, l, c, teams) = hover_fixture();
            m.d(0x19000 + 3 * 128 + 16, hero);
            m.d(0x5040, 1);
            m.q(0x5048, 0x7000);
            m.d(0x7000, 14);
            let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap();
            assert!(out.hovers.is_empty(), "hero={hero}");
            assert_eq!(out.picks.len(), 2);
            assert_eq!(out.bans, vec![14]);
        }
        let (mut m, l, c, teams) = hover_fixture();
        m.d(0x12000 + 6 * 96 + 48, 74);
        assert!(read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams)
            .unwrap()
            .hovers
            .is_empty());
        for index in [u32::MAX, 5, 64] {
            m.d(0x12000 + 6 * 96 + 56, index);
            let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap();
            assert!(out.hovers.is_empty() && out.lanes.is_empty());
            assert_eq!(out.picks.len(), 3);
        }
    }
    #[test]
    fn locking_values_and_banned_picks_do_not_reject_the_draft() {
        // Live 14.10: a non-hero value during a lock and a picked hero in the ban
        // list each rejected the whole draft. Both now keep the rest of it.
        let (mut m, l, c, teams) = hover_fixture();
        m.d(0x12000 + 6 * 96 + 48, 0x8000_0049);
        let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap();
        assert_eq!(out.picks.len(), 2);
        let (mut m, l, c, teams) = hover_fixture();
        m.d(0x12000 + 6 * 96 + 48, 74);
        m.d(0x5040, 2);
        m.q(0x5048, 0x7000);
        m.d(0x7000, 74);
        m.d(0x7004, 14);
        let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap();
        assert_eq!(out.picks.len(), 3);
        assert_eq!(out.bans, vec![14]);
    }
    #[test]
    fn optional_draft_fields_and_bounded_vectors_preserve_existing_picks() {
        assert!(DraftLayout::new(&BTreeMap::new()).is_none());
        let (m, mut l, c, teams) = hover_fixture();
        let absent = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2]).unwrap();
        assert!(absent.hovers.is_empty() && absent.lanes.is_empty());
        assert_eq!(absent.picks.len(), 2);
        assert_eq!(absent.slots.len(), 10);
        assert_eq!(absent.slots[6].team_slot, 3);
        l.draft.as_mut().unwrap().hover = None;
        let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap();
        assert!(out.hovers.is_empty() && !out.lanes.is_empty());
        l.draft.as_mut().unwrap().lane = None;
        assert!(read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams)
            .unwrap()
            .lanes
            .is_empty());
        l.draft = None;
        assert_eq!(
            read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap(),
            absent
        );
        for count in [0, 65, u32::MAX] {
            let (mut m, l, c, teams) = hover_fixture();
            m.d(0x9020, count);
            let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap();
            assert!(out.hovers.is_empty() && out.lanes.is_empty());
            assert_eq!(out.picks.len(), 2);
        }
        for pointer in [0, 0xffff, 0x7ffffffffff0, u64::MAX] {
            let (mut m, l, c, teams) = hover_fixture();
            m.q(0x9028, pointer);
            assert!(read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams)
                .unwrap()
                .hovers
                .is_empty());
        }
    }
    #[test]
    fn rejects_hover_lane_and_team_vector_changes_between_reads() {
        struct Changing {
            memory: Fixture,
            address: u64,
            reads: Cell<u32>,
        }
        impl Memory for Changing {
            fn read(&self, address: u64, len: usize) -> Result<Vec<u8>> {
                let mut data = self.memory.read(address, len)?;
                if address == self.address {
                    let n = self.reads.get();
                    self.reads.set(n + 1);
                    if n > 0 {
                        data[0] += 1;
                    }
                }
                Ok(data)
            }
        }
        for address in [
            0x12000 + 6 * 96 + 56,
            0x19000 + 3 * 128 + 16,
            0x12000 + 6 * 96 + 60,
            0x9020,
            0x9028,
        ] {
            let (memory, l, c, teams) = hover_fixture();
            let m = Changing {
                memory,
                address,
                reads: Cell::new(0),
            };
            assert!(
                read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).is_err(),
                "{address:#x}"
            );
        }
    }
    #[test]
    fn team_slots_do_not_require_hover_classes_and_are_optional() {
        let (m, mut l, c, _) = hover_fixture();
        l.draft = None;
        let read = |l: &Layout| read_stable_draft(&m, l, 0x1000, 0x4000, &c, &[None; 2]).unwrap();
        assert_eq!(read(&l).slots[6].team_slot, 3);
        l.team_slot = None;
        let out = read(&l);
        assert_eq!(out.slots.len(), 10);
        assert!(out.slots.iter().all(|slot| slot.team_slot == -1));
        assert_eq!(out.picks.len(), 2);
    }
    #[test]
    fn reads_bans_and_rejects_ambiguous_lists() {
        let (mut m, l, c) = draft_fixture();
        // Empty ban vector is valid and keeps picks.
        let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2]).unwrap();
        assert!(out.bans.is_empty() && out.picks.len() == 2);
        m.d(0x5040, 3);
        m.q(0x5048, 0x7000);
        for (i, hero) in [14u32, 74, 93].iter().enumerate() {
            m.d(0x7000 + i * 4, *hero);
        }
        assert_eq!(
            read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2])
                .unwrap()
                .bans,
            vec![14, 74, 93]
        );
        // A picked hero leaves the ban list (live bot lobby 14.10); the pick stays.
        let (mut m2, l2, c2) = draft_fixture();
        m2.d(0x5040, 3);
        m2.q(0x5048, 0x7000);
        for (i, h) in [1u32, 74, 93].iter().enumerate() {
            m2.d(0x7000 + i * 4, *h);
        }
        let out = read_stable_draft(&m2, &l2, 0x1000, 0x4000, &c2, &[None; 2]).unwrap();
        assert_eq!(out.bans, vec![74, 93]);
        assert!(out.picks.iter().any(|p| p.hero == 1));
        // Duplicates and invalid IDs are ambiguous.
        for (at, hero) in [(0x7004, 14u32), (0x7008, 0), (0x7008, 1001)] {
            let (mut m2, l2, c2) = draft_fixture();
            m2.d(0x5040, 3);
            m2.q(0x5048, 0x7000);
            for (i, h) in [14u32, 74, 93].iter().enumerate() {
                m2.d(0x7000 + i * 4, *h);
            }
            m2.d(at, hero);
            assert!(
                read_stable_draft(&m2, &l2, 0x1000, 0x4000, &c2, &[None; 2]).is_err(),
                "{at:#x}={hero}"
            );
        }
        m.d(0x5040, picks::MAX_BANS as u32 + 1);
        assert!(read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2]).is_err());
    }
    #[test]
    fn reads_partial_draft_without_touching_identity_fields() {
        struct Anonymous(Fixture);
        impl Memory for Anonymous {
            fn read(&self, address: u64, len: usize) -> Result<Vec<u8>> {
                assert!(!(0x1100..0x1300).contains(&address), "must not read names");
                assert!(
                    !(0..10).any(|i| address == 0x10000 + i * 128 + 32),
                    "must not read Steam IDs"
                );
                self.0.read(address, len)
            }
        }
        let (m, l, c, teams) = hover_fixture();
        let m = Anonymous(m);
        let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &teams).unwrap();
        assert_eq!(out.hovers.len(), 1);
        assert_eq!(out.lanes.len(), 1);
        assert_eq!(
            out.picks,
            vec![
                picks::Pick {
                    slot: 0,
                    team: 2,
                    hero: 1
                },
                picks::Pick {
                    slot: 5,
                    team: 3,
                    hero: 2
                }
            ]
        );
        let (mut m, l, c) = draft_fixture();
        for i in 0..10 {
            m.d(0x12000 + i * 96 + 48, u32::MAX);
        }
        assert!(read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2])
            .unwrap()
            .picks
            .is_empty());
    }
    #[test]
    fn rejects_draft_changes_during_read_and_invalid_layout_values() {
        struct Changing {
            memory: Fixture,
            address: u64,
            reads: Cell<u32>,
        }
        impl Memory for Changing {
            fn read(&self, address: u64, len: usize) -> Result<Vec<u8>> {
                if address == self.address {
                    let n = self.reads.get();
                    self.reads.set(n + 1);
                    if n > 0 {
                        return Ok(3u32.to_le_bytes().to_vec());
                    }
                }
                self.memory.read(address, len)
            }
        }
        // Selected hero changes between snapshots; phase/header changes mid-read.
        for address in [0x12030, 0x5010, 0x1020] {
            let (m, l, c) = draft_fixture();
            let m = Changing {
                memory: m,
                address,
                reads: Cell::new(0),
            };
            assert!(read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2]).is_err());
        }
        let (m, l, c) = draft_fixture();
        m.swap_match.set(true);
        assert!(read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2]).is_err());
        for (address, value) in [(0x1020, 65), (0x1040, 1), (0x5010, 6)] {
            let (mut m, l, c) = draft_fixture();
            m.d(address, value);
            assert!(read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2]).is_err());
        }
        // A non-hero value while a pick is locked is "not picked yet", not an error.
        let (mut m, l, c) = draft_fixture();
        m.d(0x12030, 1001);
        let out = read_stable_draft(&m, &l, 0x1000, 0x4000, &c, &[None; 2]).unwrap();
        assert!(out.picks.iter().all(|p| p.hero != 1001));
    }
    #[test]
    fn reads_two_teams_using_discovered_layout() {
        let (memory, layout, ctx) = fixture();
        let out = read_roster(&memory, &layout, 0x1000, 0x4000, &ctx).unwrap();
        assert_eq!(out.players.len(), 10);
        assert_eq!(out.players[0].name, "Player");
        assert_eq!(out.players[9].account_id, 10);
    }
    #[test]
    fn rejects_unbounded_vectors_bad_steam_ids_and_early_phase() {
        let (mut m, l, c) = fixture();
        m.d(0x1020, 65);
        assert!(read_roster(&m, &l, 0x1000, 0x4000, &c).is_err());
        let (mut m, l, c) = fixture();
        m.q(0x10000 + 32, u64::MAX);
        assert!(read_roster(&m, &l, 0x1000, 0x4000, &c).is_err());
        let (mut m, l, c) = fixture();
        m.d(0x5010, 2);
        assert!(read_roster(&m, &l, 0x1000, 0x4000, &c).is_err());
        let (m, l, c) = fixture();
        m.swap_match.set(true);
        assert!(read_roster(&m, &l, 0x1000, 0x4000, &c).is_err());
    }

    #[test]
    fn finds_nameless_entities_by_class_and_rejects_invalid_handles() {
        let mut m = Fixture {
            bytes: vec![0; 0x50000],
            swap_match: Cell::new(false),
            match_reads: Cell::new(0),
        };
        m.q(0x1050, 0x2000);
        m.q(0x2010, 0x30000);
        m.q(0x30000 + 5 * 0x70, 0x25000);
        m.d(0x30000 + 5 * 0x70 + 16, 5);
        m.q(0x30000 + 8 * 0x70, 0x26000);
        m.d(0x30000 + 8 * 0x70 + 16, 8);
        m.q(0x25000, 0x8000);
        m.q(0x26000, 0x9000);
        let types = EntityTypes {
            resource: BTreeSet::from([0x8000]),
            rules: BTreeSet::from([0x9000]),
            teams: [BTreeSet::new(), BTreeSet::new()],
        };
        assert_eq!(
            entities(&m, 0x1000, &types, &[0x50]).unwrap().1,
            (0x25000, 0x26000, [None; 2])
        );
        let types = EntityTypes {
            teams: [BTreeSet::from([0xa000]), BTreeSet::from([0xb000])],
            ..types
        };
        m.q(0x30000 + 9 * 0x70, 0x27000);
        m.d(0x30000 + 9 * 0x70 + 16, 9);
        m.q(0x27000, 0xb000);
        assert_eq!(
            entities(&m, 0x1000, &types, &[0x50]).unwrap().1 .2,
            [None, Some(0x27000)]
        );
        m.q(0x30000 + 10 * 0x70, 0x28000);
        m.d(0x30000 + 10 * 0x70 + 16, 10);
        m.q(0x28000, 0xa000);
        assert_eq!(
            entities(&m, 0x1000, &types, &[0x50]).unwrap().1 .2,
            [Some(0x28000), Some(0x27000)]
        );
        m.q(0x28000, 0xb000);
        assert!(
            entities(&m, 0x1000, &types, &[0x50]).is_err(),
            "Duplicate team data entity"
        );
        m.q(0x28000, 0xa000);
        m.d(0x30000 + 5 * 0x70 + 16, 6);
        assert!(entities(&m, 0x1000, &types, &[0x50]).is_err());
    }
}
