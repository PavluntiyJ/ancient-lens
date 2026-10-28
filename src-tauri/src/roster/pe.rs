//! Discovery in the Windows client and engine (PE, MSVC RTTI). Only reads module files and
//! returns addresses relative to the module (RVAs), so it builds and is tested on every system.
use super::source2::{EntityTypes, Memory, Result, BAD, CLASSES, DRAFT_CLASSES, TEAM_CLASSES};
use object::{
    pe::{IMAGE_FILE_MACHINE_AMD64, IMAGE_REL_BASED_DIR64},
    read::pe::{ExportTarget, ImageNtHeaders, ImageOptionalHeader, PeFile64},
    LittleEndian as LE,
};
use std::collections::{BTreeMap, BTreeSet};

fn pe(bytes: &[u8]) -> Result<PeFile64<'_>> {
    let file = PeFile64::parse(bytes).map_err(|_| BAD)?;
    if file.nt_headers().file_header().machine.get(LE) != IMAGE_FILE_MACHINE_AMD64 {
        return Err(BAD);
    }
    Ok(file)
}
/// Each section's RVA and the bytes the file holds for it.
fn sections<'a>(file: &PeFile64<'a>, bytes: &'a [u8]) -> Vec<(u64, &'a [u8])> {
    file.section_table()
        .iter()
        .filter_map(|s| Some((s.virtual_address.get(LE) as u64, s.pe_data(bytes).ok()?)))
        .collect()
}
/// Every `\0text\0` in the sections, as the RVA of the text.
fn strings(sections: &[(u64, &[u8])], text: &str) -> BTreeSet<u64> {
    let mut pattern = Vec::with_capacity(text.len() + 2);
    pattern.push(0);
    pattern.extend_from_slice(text.as_bytes());
    pattern.push(0);
    sections
        .iter()
        .flat_map(|(rva, data)| {
            memchr::memmem::find_iter(data, &pattern).map(move |off| rva + off as u64 + 1)
        })
        .collect()
}
/// Absolute pointers the loader relocates (DIR64): RVA of the pointer → RVA it points at.
fn pointers(file: &PeFile64<'_>, bytes: &[u8]) -> Result<Vec<(u64, u64)>> {
    let base = file.nt_headers().optional_header().image_base();
    let table = file.section_table();
    let blocks = file
        .data_directories()
        .relocation_blocks(bytes, &table)
        .map_err(|_| BAD)?
        .ok_or(BAD)?;
    let mut result = Vec::new();
    for block in blocks {
        for relocation in block.map_err(|_| BAD)? {
            if relocation.typ != IMAGE_REL_BASED_DIR64 {
                continue;
            }
            let Some(data) = table.pe_data_at(bytes, relocation.virtual_address) else {
                continue;
            };
            if let Some(value) = data.get(..8) {
                let value = u64::from_le_bytes(value.try_into().unwrap());
                if let Some(target) = value.checked_sub(base) {
                    result.push((relocation.virtual_address as u64, target));
                }
            }
        }
    }
    Ok(result)
}
/// RVA of the exported `CreateInterface` in engine2.dll.
pub(crate) fn create_interface(bytes: &[u8]) -> Result<u64> {
    let file = pe(bytes)?;
    let table = file.export_table().map_err(|_| BAD)?.ok_or(BAD)?;
    table
        .exports()
        .map_err(|_| BAD)?
        .into_iter()
        .find_map(|export| match (export.name, export.target) {
            (Some(b"CreateInterface"), ExportTarget::Address(rva)) => Some(rva as u64),
            _ => None,
        })
        .ok_or(BAD)
}
/// Class-info candidates: a relocated pointer to the class name sits 8 bytes into the struct,
/// as in the ELF build.
pub(crate) fn schema_candidates(bytes: &[u8]) -> Result<BTreeMap<&'static str, Vec<u64>>> {
    let file = pe(bytes)?;
    let sections = sections(&file, bytes);
    let mut names = BTreeMap::new();
    for name in CLASSES.into_iter().chain(DRAFT_CLASSES) {
        for rva in strings(&sections, name) {
            names.insert(rva, name);
        }
    }
    let mut candidates: BTreeMap<&str, Vec<u64>> = BTreeMap::new();
    for (address, target) in pointers(&file, bytes)? {
        if let Some(name) = names.get(&target) {
            if address >= 8 {
                candidates.entry(name).or_default().push(address - 8);
            }
        }
    }
    if CLASSES.iter().any(|name| !candidates.contains_key(name)) {
        return Err(BAD);
    }
    Ok(candidates)
}
/// Primary virtual tables through MSVC RTTI: the decorated name `.?AV<class>@@` sits 16 bytes
/// into its TypeDescriptor; a CompleteObjectLocator (signature 1, offset 0, TypeDescriptor RVA
/// at +12, its own RVA at +20) names that descriptor; the virtual table starts right after a
/// relocated pointer to the locator. No virtual call.
pub(crate) fn entity_types(bytes: &[u8]) -> Result<EntityTypes> {
    let file = pe(bytes)?;
    let sections = sections(&file, bytes);
    let pointers = pointers(&file, bytes)?;
    let u32_at = |data: &[u8], at: usize| {
        data.get(at..at + 4)
            .map(|v| u32::from_le_bytes(v.try_into().unwrap()))
    };
    let mut tables = Vec::new();
    for name in ["C_DOTA_PlayerResource", "C_DOTAGamerulesProxy"]
        .into_iter()
        .chain(TEAM_CLASSES)
    {
        let descriptors: BTreeSet<u32> = strings(&sections, &format!(".?AV{name}@@"))
            .into_iter()
            // `strings` wants a leading zero; the descriptor's spare word before the name is one.
            .filter_map(|rva| u32::try_from(rva.checked_sub(16)?).ok())
            .collect();
        let mut locators = BTreeSet::new();
        for descriptor in &descriptors {
            for (rva, data) in &sections {
                for off in memchr::memmem::find_iter(data, &descriptor.to_le_bytes()) {
                    let Some(at) = off.checked_sub(12) else {
                        continue;
                    };
                    let own = rva + at as u64;
                    if at % 4 == 0
                        && u32_at(data, at) == Some(1)
                        && u32_at(data, at + 4) == Some(0)
                        && u32_at(data, at + 20).map(u64::from) == Some(own)
                    {
                        locators.insert(own);
                    }
                }
            }
        }
        let primary: BTreeSet<_> = pointers
            .iter()
            .filter(|(_, target)| locators.contains(target))
            .map(|(address, _)| address + 8)
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
/// Class name of a virtual table in the running game, through its CompleteObjectLocator.
pub(crate) fn type_name(memory: &impl Memory, table: u64) -> Result<String> {
    let locator = memory.u64(table - 8)?;
    if memory.u32(locator)? != 1 {
        return Err(BAD);
    }
    let base = locator
        .checked_sub(memory.u32(locator + 20)? as u64)
        .ok_or(BAD)?;
    let name = memory.string(base + memory.u32(locator + 12)? as u64 + 16)?;
    name.strip_prefix(".?AV")
        .and_then(|name| name.strip_suffix("@@"))
        .map(str::to_owned)
        .ok_or(BAD)
}

#[cfg(test)]
mod tests {
    use super::super::source2::{class_at, Layout};
    use super::*;
    use std::time::Instant;

    /// A module file seen as loaded at address 0: RVAs are addresses and relocated pointers
    /// hold RVAs.
    struct Image<'a> {
        sections: Vec<(u64, &'a [u8])>,
        pointers: BTreeMap<u64, u64>,
    }
    impl Memory for Image<'_> {
        fn read(&self, address: u64, len: usize) -> Result<Vec<u8>> {
            let mut bytes = self
                .sections
                .iter()
                .find_map(|(rva, data)| {
                    let start = address.checked_sub(*rva)? as usize;
                    data.get(start..start + len)
                })
                .ok_or(BAD)?
                .to_vec();
            for (&at, &value) in self.pointers.range(address..address + len as u64) {
                let offset = (at - address) as usize;
                if offset + 8 <= len {
                    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
                }
            }
            Ok(bytes)
        }
    }

    /// Offline compatibility check against an installed client.dll; never starts or attaches
    /// to Dota. `ANCIENT_CLIENT_DLL=<…/game/dota/bin/win64/client.dll>`.
    #[test]
    #[ignore = "requires ANCIENT_CLIENT_DLL pointing to the installed client.dll"]
    fn installed_client_dll_schema() {
        let bytes = std::fs::read(std::env::var("ANCIENT_CLIENT_DLL").unwrap()).unwrap();
        let started = Instant::now();
        let candidates = schema_candidates(&bytes).unwrap();
        let types = entity_types(&bytes).unwrap();
        println!(
            "Discovery in {} MB took {:?}",
            bytes.len() >> 20,
            started.elapsed()
        );
        let file = pe(&bytes).unwrap();
        let mut pointers: BTreeMap<u64, u64> = super::pointers(&file, &bytes)
            .unwrap()
            .into_iter()
            .collect();
        // The schema registration sets this self pointer when Dota loads a class.
        for list in candidates.values() {
            for &address in list {
                pointers.insert(address, address);
            }
        }
        let memory = Image {
            sections: sections(&file, &bytes),
            pointers,
        };
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
        let types = types.verified(|table| type_name(&memory, table)).unwrap();
        assert!(!types.resource.is_empty() && !types.rules.is_empty());
        assert!(
            types.teams.iter().all(|tables| !tables.is_empty()),
            "Team RTTI tables"
        );
        for name in CLASSES.into_iter().chain(DRAFT_CLASSES) {
            println!("{name}: size {:#x}", classes[name].size);
        }
        println!(
            "m_iRankTier {:#x}; m_nSelectedHeroID {:#x}; m_iTeamSlot {:#x}; m_eLaneSelectionFlags {:#x}",
            classes[CLASSES[1]].field("m_iRankTier", 4).unwrap(),
            classes[CLASSES[2]].field("m_nSelectedHeroID", 4).unwrap(),
            classes[CLASSES[2]].field("m_iTeamSlot", 4).unwrap(),
            classes[CLASSES[2]].field("m_eLaneSelectionFlags", 1).unwrap(),
        );
        println!(
            "Virtual tables: resource {:x?}, rules {:x?}, teams {:x?}",
            types.resource, types.rules, types.teams
        );
    }

    /// `ANCIENT_ENGINE2_DLL=<…/game/bin/win64/engine2.dll>`: the export decodes to a registry
    /// load inside the image. Its list is built when Dota loads, so the walk needs the game.
    #[test]
    #[ignore = "requires ANCIENT_ENGINE2_DLL pointing to the installed engine2.dll"]
    fn installed_engine2_exports_create_interface() {
        use iced_x86::{Decoder, DecoderOptions, Mnemonic};
        let bytes = std::fs::read(std::env::var("ANCIENT_ENGINE2_DLL").unwrap()).unwrap();
        let rva = create_interface(&bytes).unwrap();
        let file = pe(&bytes).unwrap();
        let memory = Image {
            sections: sections(&file, &bytes),
            pointers: BTreeMap::new(),
        };
        let code = memory.read(rva, 160).unwrap();
        let registry = Decoder::with_ip(64, &code, rva, DecoderOptions::NONE)
            .into_iter()
            .find(|i| i.mnemonic() == Mnemonic::Mov && i.is_ip_rel_memory_operand())
            .expect("RIP-relative registry load")
            .ip_rel_memory_address();
        // The head lives in zero-initialised data, which may extend past the file's bytes.
        assert!(file.section_table().iter().any(|s| {
            let (start, size) = s.pe_address_range();
            (start as u64..start as u64 + size as u64).contains(&registry)
        }));
        println!("engine2.dll CreateInterface {rva:#x}, registry head {registry:#x}");
    }
}
