//! Locates the rating getter, account collection and game clock in libclient.so by code
//! shape and formula constants (see docs/dev/native-reader.md).
//! Each function must match byte for byte except rel32/RIP displacements (`??`), and the
//! formula constants must equal the ones in `confidence`, so a patch that only moves code
//! keeps working while one that changes the logic fails closed.
use object::{Object, ObjectSection};

/// ELF virtual addresses inside libclient.so relative to the module load base.
#[derive(Clone, Debug, PartialEq)]
pub struct Layout {
    pub getter: usize,
    pub root: usize,
    pub clock: usize,
    /// First getter bytes on disk, to confirm the loaded module is this file.
    pub prefix: [u8; 16],
}

/// `call getter; mov edi, 0x96; mov r15d/r14d, eax; call …; lea rsi, "rank_confidence"`.
const ANCHOR: &str = "e8 ?? ?? ?? ?? bf 96 00 00 00 41 89 ?? e8 ?? ?? ?? ?? 48 8d 35 ?? ?? ?? ??";
/// Getter: look up key 6, wrap it, apply the time correction, jump to the percent mapping.
const GETTER: &str = "55 48 89 e5 41 54 53 48 8d 5d d0 48 83 ec 30 48 89 df c7 45 d0 06 00 00 00 e8 ?? ?? ?? ?? 48 85 c0 74 36 8b 70 1c 4c 8d 65 c8 41 b9 06 00 00 00 48 89 df 8b 48 24 8b 50 20 44 8b 40 28 e8 ?? ?? ?? ?? 48 89 de 4c 89 e7 e8 ?? ?? ?? ?? 4c 89 e7 e8 ?? ?? ?? ?? 84 c0 74 17 48 83 c4 30 bf e8 03 00 00 5b 41 5c 5d e9 ?? ?? ?? ?? 0f 1f 44 00 00 4c 89 e7 e8 ?? ?? ?? ?? 48 83 c4 30 5b 89 c7 41 5c 5d e9 ?? ?? ?? ??";
/// Fast-path head of the account collection lookup: reads root+0x20, root+0x14, root+0x18,
/// node stride 0x20, key at node+0x10 and object at **(node+0x18).
const LOOKUP: &str = "55 48 89 e5 41 57 41 56 41 55 41 54 49 89 fc 53 48 83 ec 28 48 63 05 ?? ?? ?? ?? 44 8b 07 83 f8 ff 74 7d 8b 35 ?? ?? ?? ?? b9 00 00 00 00 48 8b 3d ?? ?? ?? ?? 81 e6 ff ff ff 7f 48 0f 45 cf 48 c1 e0 05 48 8d 14 01 44 3b 42 10 7c 4b 0f 8f ?? ?? ?? ?? 31 d2 85 f6 48 0f 44 fa 48 8b 5c 07 18 48 85 db 74 3b 80 7b 14 00 48 8b 03 75 14 48 85 c0 8b 53 08 0f 84 ?? ?? ?? ?? 85 d2 0f 84 ?? ?? ?? ?? 48 83 c4 28 5b 41 5c 41 5d 41 5e 41 5f 5d c3";
/// Time correction with inlined math: reads the game clock and applies 250²-90² (54400),
/// 86400, 0.3, 80, sqrt, +0.5 and clamp to 90..3000.
const CORRECTION: &str = "55 48 89 e5 41 57 41 56 41 55 4c 8d 2d ?? ?? ?? ?? 41 54 53 48 83 ec 08 48 8b 1f 48 8b 13 48 8b 02 4c 39 e8 0f 85 ?? ?? ?? ?? 8b 43 18 83 e8 05 48 8b 52 08 83 f8 01 76 27 48 8d 05 ?? ?? ?? ?? 48 39 c2 0f 85 ?? ?? ?? ?? 8b 43 0c 48 83 c4 08 5b 41 5c 41 5d 41 5e 41 5f 5d c3 0f 1f 44 00 00 4c 8d 3d ?? ?? ?? ?? 4c 39 fa 0f 85 ?? ?? ?? ?? 48 8d 05 ?? ?? ?? ?? 44 8b 63 0c 44 8b 30 8b 43 14 41 29 c6 85 c0 0f 84 ?? ?? ?? ?? 45 85 f6 0f 8e ?? ?? ?? ?? 48 8b 03 48 8b 00 4c 39 e8 0f 85 ?? ?? ?? ?? 8b 43 18 83 f8 06 0f 87 ?? ?? ?? ?? ba 54 00 00 00 48 0f a3 c2 0f 83 ?? ?? ?? ?? f3 0f 10 15 ?? ?? ?? ?? 66 0f ef c0 66 0f ef c9 f3 41 0f 2a c6 44 89 e0 f3 0f 5e 05 ?? ?? ?? ?? f3 0f 59 05 ?? ?? ?? ?? f3 0f 5e 05 ?? ?? ?? ?? 0f 2f c8 0f 83 ?? ?? ?? ?? 66 0f ef c9 f3 41 0f 2a cc f3 0f 59 c2 ba 5a 00 00 00 f3 0f 59 c9 f3 0f 58 c1 f3 0f 51 c0 f3 0f 58 05 ?? ?? ?? ?? f3 0f 2c c0 39 d0 0f 4c c2 ba b8 0b 00 00 39 d0 0f 4f c2 48 83 c4 08 5b 41 5c 41 5d 41 5e 41 5f 5d c3 48 83 c4 08 44 89 e0 5b 41 5c 41 5d 41 5e 41 5f 5d c3 66 0f 1f 44 00 00 49 89 fc 48 89 df ff d0 49 8b 1c 24 48 8b 13 e9 ?? ?? ?? ?? 0f 1f 40 00 48 83 c4 08 48 89 df be 02 00 00 00 5b 41 5c 41 5d 41 5e 41 5f 5d ff e2 0f 1f 84 00 00 00 00 00 f3 0f 10 15 ?? ?? ?? ?? e9 ?? ?? ?? ?? 0f 1f 00 be 02 00 00 00 48 89 df ff d2 41 89 c4 48 8d 05 ?? ?? ?? ?? 44 8b 30 48 8b 03 48 8b 40 08 4c 39 f8 0f 84 ?? ?? ?? ?? be 04 00 00 00 48 89 df ff d0 e9 ?? ?? ?? ?? 66 2e 0f 1f 84 00 00 00 00 00 48 89 df ff d0 e9 ?? ?? ?? ??";
/// Percent mapping: three polynomials split at 165/240/820 with their clamps.
const PERCENT: &str = "55 81 ff a5 00 00 00 48 89 e5 0f 8e ?? ?? ?? ?? 81 ff f0 00 00 00 7e 60 31 c0 81 ff 34 03 00 00 7f 4d 66 0f ef c9 f2 0f 2a cf f2 0f 10 05 ?? ?? ?? ?? f2 0f 59 c1 f2 0f 59 c1 f2 0f 59 0d ?? ?? ?? ?? f2 0f 5c c1 f2 0f 58 05 ?? ?? ?? ?? f2 0f 5a c0 e8 ?? ?? ?? ?? ba 01 00 00 00 f3 0f 2c c0 85 c0 0f 4e c2 ba 07 00 00 00 39 d0 0f 4f c2 5d c3 0f 1f 80 00 00 00 00 66 0f ef c9 f2 0f 2a cf f2 0f 10 05 ?? ?? ?? ?? f2 0f 59 c1 f2 0f 59 c1 f2 0f 59 0d ?? ?? ?? ?? f2 0f 5c c1 f2 0f 58 05 ?? ?? ?? ?? f2 0f 5a c0 e8 ?? ?? ?? ?? ba 07 00 00 00 5d f3 0f 2c c0 39 d0 0f 4c c2 ba 12 00 00 00 39 d0 0f 4f c2 c3 66 0f 1f 84 00 00 00 00 00 66 0f ef c9 f2 0f 2a cf f2 0f 10 05 ?? ?? ?? ?? f2 0f 59 c1 f2 0f 59 c1 f2 0f 59 0d ?? ?? ?? ?? f2 0f 5c c1 f2 0f 58 05 ?? ?? ?? ?? f2 0f 5a c0 e8 ?? ?? ?? ?? ba 12 00 00 00 5d f3 0f 2c c0 39 d0 0f 4c c2 ba 64 00 00 00 39 d0 0f 4f c2 c3";
/// Displacement offsets in PERCENT and the double each must reference.
const POLYNOMIALS: [(usize, f64); 9] = [
    (0xdc, 0.0056),
    (0xec, 2.55),
    (0xf8, 286.56),
    (0x84, 0.0016),
    (0x94, 0.8022),
    (0xa0, 107.78),
    (0x2e, 0.0000165),
    (0x3e, 0.0283),
    (0x4a, 12.6),
];

fn pattern(text: &str) -> Vec<Option<u8>> {
    text.split(' ')
        .map(|b| (b != "??").then(|| u8::from_str_radix(b, 16).unwrap()))
        .collect()
}

struct Image<'a> {
    bytes: &'a [u8],
    /// (virtual address, file-backed size, raw file offset, virtual size, is .data/.bss)
    sections: Vec<(usize, usize, usize, usize, bool)>,
    text: usize,
}
impl<'a> Image<'a> {
    fn parse(bytes: &'a [u8]) -> Option<Self> {
        let elf = object::File::parse(bytes).ok()?;
        if elf.architecture() != object::Architecture::X86_64
            || !elf.is_little_endian()
            || elf.format() != object::BinaryFormat::Elf
        {
            return None;
        }
        let mut sections = vec![];
        let mut text = None;
        for section in elf.sections() {
            let size = usize::try_from(section.size()).ok()?;
            let va = usize::try_from(section.address()).ok()?;
            if size == 0 || va == 0 {
                continue;
            }
            let (raw, raw_size) = match section.file_range() {
                Some((off, len)) => (usize::try_from(off).ok()?, usize::try_from(len).ok()?),
                None => (0, 0),
            };
            let name = section.name().unwrap_or("");
            if name == ".text" {
                text = Some(sections.len());
            }
            let data = matches!(name, ".data" | ".bss");
            sections.push((va, size.min(raw_size), raw, size, data));
        }
        Some(Self {
            bytes,
            sections,
            text: text?,
        })
    }
    /// A global in .data or .bss outside code.
    fn global(&self, rva: usize) -> bool {
        let (text_va, _, _, text_size, _) = self.sections[self.text];
        !(text_va..text_va + text_size).contains(&rva)
            && self
                .sections
                .iter()
                .any(|&(va, _, _, size, data)| data && (va..va + size).contains(&rva))
    }
    fn at(&self, rva: usize, n: usize) -> Option<&'a [u8]> {
        let &(va, size, raw, ..) = self
            .sections
            .iter()
            .find(|&&(va, size, ..)| (va..va + size).contains(&rva))?;
        if rva + n > va + size {
            return None;
        }
        self.bytes.get(raw + rva - va..raw + rva - va + n)
    }
    /// Target of a rel32/RIP displacement that ends its instruction.
    fn target(&self, field: usize) -> Option<usize> {
        let disp = i32::from_le_bytes(self.at(field, 4)?.try_into().ok()?);
        (field as i64 + 4 + disp as i64).try_into().ok()
    }
    fn matches(&self, rva: usize, pattern: &[Option<u8>]) -> bool {
        self.at(rva, pattern.len()).is_some_and(|code| {
            code.iter()
                .zip(pattern)
                .all(|(b, p)| p.is_none_or(|p| p == *b))
        })
    }
    fn f32_at(&self, field: usize) -> Option<f32> {
        Some(f32::from_le_bytes(
            self.at(self.target(field)?, 4)?.try_into().ok()?,
        ))
    }
    fn f64_at(&self, field: usize) -> Option<f64> {
        Some(f64::from_le_bytes(
            self.at(self.target(field)?, 8)?.try_into().ok()?,
        ))
    }
}

pub fn locate(bytes: &[u8]) -> Option<Layout> {
    let image = Image::parse(bytes)?;
    let (text_va, text_size, text_raw, ..) = image.sections[image.text];
    let anchor = pattern(ANCHOR);
    let code = image.bytes.get(text_raw..text_raw + text_size)?;
    let mut getters = vec![];
    for hit in memchr::memmem::find_iter(code, &[0xbf, 0x96, 0x00, 0x00, 0x00]) {
        if hit < 5 {
            continue;
        }
        let i = hit - 5;
        let rva = text_va + i;
        if code[i] != 0xe8 || !image.matches(rva, &anchor) {
            continue;
        }
        let name = image.at(image.target(rva + 21)?, 16)?;
        if name == b"rank_confidence\0" {
            getters.push(image.target(rva + 1)?);
        }
    }
    // Every anchor must agree on one getter; never pick the first of different ones.
    getters.dedup();
    let [getter] = getters[..] else { return None };
    if !image.matches(getter, &pattern(GETTER)) {
        return None;
    }
    let (lookup, percent, correction) = (
        image.target(getter + 0x1a)?,
        image.target(getter + 0x67)?,
        image.target(getter + 0x74)?,
    );
    if image.target(getter + 0x83)? != percent
        || !image.matches(lookup, &pattern(LOOKUP))
        || !image.matches(correction, &pattern(CORRECTION))
        || !image.matches(percent, &pattern(PERCENT))
    {
        return None;
    }
    let nodes = image.target(lookup + 0x31)?;
    let root = nodes.checked_sub(0x18)?;
    if image.target(lookup + 0x17)? != root + 0x20 || image.target(lookup + 0x25)? != root + 0x14 {
        return None;
    }
    let clock = image.target(correction + 0x73)?;
    let round = image.target(percent + 0x53)?;
    let constants = image.target(correction + 0x1b0)? == clock
        && image.f32_at(correction + 0xc3)? == 250.0_f32.powi(2) - 90.0_f32.powi(2)
        && image.f32_at(correction + 0x194)? == 500.0_f32.powi(2) - 90.0_f32.powi(2)
        && image.f32_at(correction + 0xdb)? == 86400.0
        && image.f32_at(correction + 0xe3)? == 0.3
        && image.f32_at(correction + 0xeb)? == 80.0
        && image.f32_at(correction + 0x11a)? == 0.5
        && image.target(percent + 0xa9)? == round
        && image.target(percent + 0x101)? == round;
    if !constants
        || POLYNOMIALS
            .iter()
            .any(|&(field, value)| image.f64_at(percent + field) != Some(value))
    {
        return None;
    }
    if !image.global(root) || !image.global(clock) {
        return None;
    }
    Some(Layout {
        getter,
        root,
        clock,
        prefix: image.at(getter, 16)?.try_into().ok()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patterns_cover_the_documented_functions() {
        for (text, len) in [
            (GETTER, 0x87),
            (LOOKUP, 0x91),
            (CORRECTION, 0x1ea),
            (PERCENT, 0x11f),
            (ANCHOR, 25),
        ] {
            assert_eq!(pattern(text).len(), len);
        }
        for &(field, _) in &POLYNOMIALS {
            assert!(pattern(PERCENT)[field..field + 4]
                .iter()
                .all(Option::is_none));
        }
        assert!(locate(b"\x7fELF").is_none());
    }

    /// `ANCIENT_DOTA_CLIENT=<…/linuxsteamrt64/libclient.so> cargo test -- --ignored` on the researched build.
    #[test]
    #[ignore = "requires ANCIENT_DOTA_CLIENT pointing to the installed libclient.so"]
    fn installed_libclient_matches_the_researched_layout() {
        let path = std::env::var("ANCIENT_DOTA_CLIENT").expect("ANCIENT_DOTA_CLIENT");
        let mut bytes = std::fs::read(path).unwrap();
        let layout = locate(&bytes).expect("layout");
        assert_eq!(
            (layout.getter, layout.root, layout.clock),
            (0x6b149c0, 0x98b7380, 0x9ad78c8)
        );
        // A changed formula constant (0.0056 → other) must fail closed.
        let image = Image::parse(&bytes).unwrap();
        let constant = image.target(0x6acca10 + 0xdc).unwrap();
        let &(va, _, raw, ..) = image
            .sections
            .iter()
            .find(|&&(va, size, ..)| (va..va + size).contains(&constant))
            .unwrap();
        bytes[raw + constant - va] ^= 1;
        assert!(locate(&bytes).is_none());
    }
}
