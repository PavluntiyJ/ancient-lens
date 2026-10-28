//! Discovery in the Linux client and engine (ELF, Itanium RTTI). Only reads module files and
//! returns addresses relative to the module, so it builds and is tested on every system.
use super::source2::{EntityTypes, Memory, Result, BAD, CLASSES, DRAFT_CLASSES, TEAM_CLASSES};
use object::{Object, ObjectSegment, ObjectSymbol, RelocationFlags};
use std::collections::{BTreeMap, BTreeSet};

fn elf(data: &[u8]) -> Result<object::File<'_>> {
    let image = object::File::parse(data).map_err(|_| BAD)?;
    if image.architecture() != object::Architecture::X86_64
        || !image.is_little_endian()
        || image.format() != object::BinaryFormat::Elf
    {
        return Err(BAD);
    }
    Ok(image)
}
/// Address of the exported `CreateInterface` in libengine2.so.
pub(crate) fn create_interface(bytes: &[u8]) -> Result<u64> {
    elf(bytes)?
        .dynamic_symbols()
        .find(|s| s.name().ok() == Some("CreateInterface") && s.address() != 0)
        .map(|s| s.address())
        .ok_or(BAD)
}
pub(crate) fn schema_candidates(bytes: &[u8]) -> Result<BTreeMap<&'static str, Vec<u64>>> {
    let image = elf(bytes)?;
    let mut names = BTreeMap::new();
    // Search only mapped ELF data, then resolve its relative relocations. No address
    // or field offset from a previous Dota version is cached on disk.
    for segment in image.segments() {
        let data = segment.data().map_err(|_| BAD)?;
        for name in CLASSES.into_iter().chain(DRAFT_CLASSES) {
            let mut pattern = Vec::with_capacity(name.len() + 2);
            pattern.push(0);
            pattern.extend_from_slice(name.as_bytes());
            pattern.push(0);
            for offset in memchr::memmem::find_iter(data, &pattern) {
                names.insert(segment.address() + offset as u64 + 1, name);
            }
        }
    }
    let mut candidates: BTreeMap<&str, Vec<u64>> = BTreeMap::new();
    for (address, relocation) in image.dynamic_relocations().ok_or(BAD)? {
        if relocation.flags()
            == (RelocationFlags::Elf {
                r_type: object::elf::R_X86_64_RELATIVE,
            })
        {
            if let Some(name) = names.get(&(relocation.addend() as u64)) {
                if address >= 8 {
                    candidates.entry(name).or_default().push(address - 8);
                }
            }
        }
    }
    if CLASSES.iter().any(|name| !candidates.contains_key(name)) {
        return Err(BAD);
    }
    Ok(candidates)
}
pub(crate) fn entity_types(bytes: &[u8]) -> Result<EntityTypes> {
    let image = elf(bytes)?;
    let reloc: Vec<_> = image
        .dynamic_relocations()
        .ok_or(BAD)?
        .filter(|(_, r)| {
            r.flags()
                == (RelocationFlags::Elf {
                    r_type: object::elf::R_X86_64_RELATIVE,
                })
        })
        .map(|(a, r)| (a, r.addend() as u64))
        .collect();
    let mut tables = Vec::new();
    for name in ["C_DOTA_PlayerResource", "C_DOTAGamerulesProxy"]
        .into_iter()
        .chain(TEAM_CLASSES)
    {
        let pattern = format!("\0{}{name}\0", name.len());
        let mut strings = BTreeSet::new();
        for segment in image.segments() {
            for off in
                memchr::memmem::find_iter(segment.data().map_err(|_| BAD)?, pattern.as_bytes())
            {
                strings.insert(segment.address() + off as u64 + 1);
            }
        }
        // Itanium RTTI points to the encoded class name; a primary virtual table
        // has offset-to-top zero followed by that RTTI pointer. No virtual call.
        let rtti: BTreeSet<_> = reloc
            .iter()
            .filter(|(a, v)| *a >= 8 && strings.contains(v))
            .map(|(a, _)| a - 8)
            .collect();
        let primary: BTreeSet<_> = reloc
            .iter()
            .filter(|(a, v)| {
                *a >= 8
                    && rtti.contains(v)
                    && image
                        .segments()
                        .any(|s| s.data_range(a - 8, 8).ok().flatten() == Some(&[0u8; 8]))
            })
            .map(|(a, _)| a + 8)
            .collect();
        if primary.is_empty() || primary.len() > 8 {
            if !TEAM_CLASSES.contains(&name) {
                return Err(BAD);
            }
            tables.push(BTreeSet::new());
        } else {
            tables.push(primary);
        }
    }
    Ok(EntityTypes {
        resource: tables.remove(0),
        rules: tables.remove(0),
        teams: [tables.remove(0), tables.remove(0)],
    })
}
/// Class name of a virtual table in the running game: the slot before it points at the
/// Itanium type info, whose second word is the encoded name, e.g. `21C_DOTA_PlayerResource`.
pub(crate) fn type_name(memory: &impl Memory, table: u64) -> Result<String> {
    let rtti = memory.u64(table - 8)?;
    let encoded = memory.string(memory.u64(rtti + 8)?)?;
    let digits = encoded.bytes().take_while(u8::is_ascii_digit).count();
    let name = &encoded[digits..];
    if encoded[..digits].parse::<usize>().ok() != Some(name.len()) {
        return Err(BAD);
    }
    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::super::source2::{class_at, Layout};
    use super::*;

    /// Offline compatibility check; explicitly opt in with a game installation (any system).
    /// It reads ELF/schema declarations, never starts or attaches to Dota.
    #[test]
    #[ignore = "requires ANCIENT_DOTA_CLIENT pointing to the installed libclient.so"]
    fn installed_client_schema() {
        let path = std::env::var("ANCIENT_DOTA_CLIENT").unwrap();
        let bytes = std::fs::read(path).unwrap();
        let image = elf(&bytes).unwrap();
        let candidates = schema_candidates(&bytes).unwrap();
        let types = entity_types(&bytes).unwrap();
        assert!(!types.resource.is_empty() && !types.rules.is_empty());
        assert!(
            types.teams.iter().all(|tables| !tables.is_empty()),
            "Team RTTI tables"
        );
        struct Image<'a> {
            image: object::File<'a>,
            reloc: BTreeMap<u64, u64>,
        }
        impl Memory for Image<'_> {
            fn read(&self, address: u64, len: usize) -> Result<Vec<u8>> {
                let mut bytes = self
                    .image
                    .segments()
                    .find_map(|s| s.data_range(address, len as u64).ok().flatten())
                    .ok_or(BAD)?
                    .to_vec();
                for (&at, &value) in self.reloc.range(address..address + len as u64) {
                    let offset = (at - address) as usize;
                    if offset + 8 <= len {
                        bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
                    }
                }
                Ok(bytes)
            }
        }
        let mut reloc: BTreeMap<u64, u64> = image
            .dynamic_relocations()
            .unwrap()
            .filter(|(_, r)| {
                r.flags()
                    == (RelocationFlags::Elf {
                        r_type: object::elf::R_X86_64_RELATIVE,
                    })
            })
            .map(|(a, r)| (a, r.addend() as u64))
            .collect();
        // The schema registration sets this self pointer when Dota loads a class.
        for list in candidates.values() {
            for &address in list {
                reloc.insert(address, address);
            }
        }
        let memory = Image { image, reloc };
        let types = types.verified(|table| type_name(&memory, table)).unwrap();
        assert!(types.teams.iter().all(|tables| !tables.is_empty()));
        let classes: BTreeMap<_, _> = candidates
            .into_iter()
            .map(|(name, list)| {
                let parsed: Vec<_> = list
                    .into_iter()
                    .filter_map(|a| class_at(&memory, a).ok())
                    .collect();
                assert_eq!(parsed.len(), 1, "{name} must resolve unambiguously");
                (name, parsed.into_iter().next().unwrap())
            })
            .collect();
        let layout = Layout::new(&classes).unwrap();
        assert!(layout.player_size > layout.steam + 8);
        assert!(layout.team_size > layout.hero + 4);
        assert!(
            layout.bans.is_some(),
            "m_vecNewBannedHeroes not in C_DOTAGamerules"
        );
        let player = classes
            .get(DRAFT_CLASSES[0])
            .expect("DataTeamPlayer_t schema");
        let container = classes
            .get(DRAFT_CLASSES[1])
            .expect("C_DOTA_DataNonSpectator schema");
        for signature in [
            "15CNetworkVarBaseI8HeroID_tN16DataTeamPlayer_t35NetworkVar_m_nPossibleHeroSelectionEE",
            "29C_UtlVectorEmbeddedNetworkVarI16DataTeamPlayer_tN23C_DOTA_DataNonSpectator24NetworkVar_m_vecDataTeamELin1EiE",
            "15CNetworkVarBaseIiN30PlayerResourcePlayerTeamData_t22NetworkVar_m_iTeamSlotEE",
            "15CNetworkVarBaseIiN26PlayerResourcePlayerData_t22NetworkVar_m_iRankTierEE",
            "15CNetworkVarBaseIhN30PlayerResourcePlayerTeamData_t32NetworkVar_m_eLaneSelectionFlagsEE",
            "18C_DOTA_DataRadiant", "15C_DOTA_DataDire",
        ] {
            assert!(memchr::memmem::find(&bytes, signature.as_bytes()).is_some(), "Missing type signature: {signature}");
        }
        println!(
            "PlayerResourcePlayerData_t::m_iRankTier (int32, 4 bytes)={:#x}",
            classes[CLASSES[1]].field("m_iRankTier", 4).unwrap()
        );
        println!("DataTeamPlayer_t size={:#x}; m_nPossibleHeroSelection (HeroID_t)={:#x}; C_DOTA_DataNonSpectator::m_vecDataTeam={:#x}; m_iTeamSlot (int)={:#x}; m_eLaneSelectionFlags (uint8)={:#x}",
            player.size, player.field("m_nPossibleHeroSelection", 4).unwrap(), container.field("m_vecDataTeam", 16).unwrap(),
            classes[CLASSES[2]].field("m_iTeamSlot", 4).unwrap(), classes[CLASSES[2]].field("m_eLaneSelectionFlags", 1).unwrap());
        println!(
            "Resolved required roster schemas and optional draft schemas from the installed ELF"
        );
    }

    #[test]
    #[ignore = "requires ANCIENT_DOTA_ENGINE pointing to the installed libengine2.so"]
    fn installed_engine_exports_create_interface() {
        let path = std::env::var("ANCIENT_DOTA_ENGINE").unwrap();
        let address = create_interface(&std::fs::read(path).unwrap()).unwrap();
        println!("libengine2.so CreateInterface at {address:#x}");
    }
}
