//! Locates the rating getter, account collection and game clock in client.dll by code
//! shape instead of per-build RVAs (see docs/dev/native-reader.md).
//! Each function must match byte for byte except rel32/RIP displacements (`??`), and the
//! formula constants must equal the ones in `confidence`, so a patch that only moves code
//! keeps working while one that changes the logic fails closed.

/// RVAs inside client.dll.
#[derive(Clone, Debug, PartialEq)]
pub struct Layout {
    pub getter: usize,
    pub root: usize,
    pub clock: usize,
    /// First getter bytes on disk, to confirm the loaded module is this file.
    pub prefix: [u8; 16],
}

/// `call getter; mov ecx, 0x96; mov edi, eax; call …; lea rdx, "rank_confidence"`.
const ANCHOR: &str = "e8 ?? ?? ?? ?? b9 96 00 00 00 ?? ?? e8 ?? ?? ?? ?? 48 8d 15 ?? ?? ?? ??";
/// Getter: look up key 6, wrap it, apply the time correction, jump to the percent mapping.
const GETTER: &str = "48 83 ec 58 48 8d 54 24 68 c7 44 24 68 06 00 00 00 48 8d 0d ?? ?? ?? ?? e8 ?? ?? ?? ?? 48 8b d0 48 85 c0 74 41 44 8b 4a 24 48 8d 4c 24 30 44 8b 42 20 8b 40 28 8b 52 1c c7 44 24 28 06 00 00 00 89 44 24 20 e8 ?? ?? ?? ?? 48 8d 54 24 30 48 8d 4c 24 70 e8 ?? ?? ?? ?? 48 8d 4c 24 70 e8 ?? ?? ?? ?? 84 c0 74 10 b8 e8 03 00 00 8b c8 48 83 c4 58 e9 ?? ?? ?? ?? 48 8d 4c 24 70 e8 ?? ?? ?? ?? 8b c8 48 83 c4 58 e9 ?? ?? ?? ??";
/// Time correction caller: reads the clock and passes 250/500, 90, 80 and 0.3.
const CORRECTION: &str = "40 53 48 83 ec 30 48 8b d9 48 8b 09 48 8b 01 ff 10 83 e8 05 74 16 83 f8 01 74 11 48 8b 0b b2 02 48 8b 01 48 83 c4 30 5b 48 ff 60 08 48 8b 1b b2 02 48 89 74 24 40 48 8b cb 48 89 7c 24 48 48 8b 03 ff 50 08 8b 3d ?? ?? ?? ?? b2 04 8b f0 48 8b cb 48 8b 03 ff 50 08 2b f8 33 c9 85 ff 0f 4e f9 85 c0 74 56 85 ff 7e 52 48 8b 03 48 8b cb ff 10 8d 48 fe f7 c1 f9 ff ff ff 75 09 83 f8 08 74 04 b1 01 eb 02 32 c9 f3 0f 10 1d ?? ?? ?? ?? 84 c9 ba fa 00 00 00 b8 f4 01 00 00 0f 45 c2 41 b8 50 00 00 00 89 44 24 28 8b d7 8b ce c7 44 24 20 5a 00 00 00 e8 ?? ?? ?? ?? 8b f0 48 8b 7c 24 48 8b c6 48 8b 74 24 40 48 83 c4 30 5b c3";
/// Correction math: elapsed/86400 * 0.3 / 80, square root, +0.5, clamp to 90..3000.
const MATH: &str = "48 83 ec 28 66 0f 6e e2 0f 5b e4 66 41 0f 6e c0 f3 0f 5e 25 ?? ?? ?? ?? 0f 5b c0 f3 0f 59 e3 0f 57 db f3 0f 5e e0 0f 2f dc 72 07 8b c1 48 83 c4 28 c3 0f 57 d2 48 89 5c 24 20 f3 0f 2a 54 24 58 8b 5c 24 50 0f 57 c0 0f 57 c9 f3 0f 59 d2 f3 0f 2a c3 f3 0f 2a c9 f3 0f 59 c0 f3 0f 59 c9 f3 0f 5c d0 f3 0f 59 d4 f3 0f 58 d1 0f 2f da 76 0c 8b c3 48 8b 5c 24 20 48 83 c4 28 c3 0f 57 c0 0f 2e c2 77 09 0f 57 c0 f3 0f 51 c2 eb 08 0f 28 c2 e8 ?? ?? ?? ?? f3 0f 58 05 ?? ?? ?? ?? f3 0f 2c c0 3b c3 0f 4f d8 b8 b8 0b 00 00 3b d8 0f 4c c3 48 8b 5c 24 20 48 83 c4 28 c3";
/// Percent mapping: three polynomials split at 165/240/820 with their clamps.
const PERCENT: &str = "48 83 ec 28 81 f9 a5 00 00 00 7f 51 66 0f 6e c1 f3 0f e6 c0 0f 28 c8 f2 0f 59 0d ?? ?? ?? ?? f2 0f 59 c8 f2 0f 59 05 ?? ?? ?? ?? f2 0f 5c c8 f2 0f 58 0d ?? ?? ?? ?? 66 0f 5a c1 ff 15 ?? ?? ?? ?? f3 0f 2c c0 83 f8 12 7e 5e 83 f8 64 0f 8c c0 00 00 00 b8 64 00 00 00 48 83 c4 28 c3 81 f9 f0 00 00 00 7f 4d 66 0f 6e c1 f3 0f e6 c0 0f 28 c8 f2 0f 59 0d ?? ?? ?? ?? f2 0f 59 c8 f2 0f 59 05 ?? ?? ?? ?? f2 0f 5c c8 f2 0f 58 0d ?? ?? ?? ?? 66 0f 5a c1 ff 15 ?? ?? ?? ?? f3 0f 2c c0 83 f8 07 7e 5a 83 f8 12 7c 6b b8 12 00 00 00 48 83 c4 28 c3 81 f9 34 03 00 00 7f 57 66 0f 6e c1 f3 0f e6 c0 0f 28 c8 f2 0f 59 0d ?? ?? ?? ?? f2 0f 59 c8 f2 0f 59 05 ?? ?? ?? ?? f2 0f 5c c8 f2 0f 58 0d ?? ?? ?? ?? 66 0f 5a c1 ff 15 ?? ?? ?? ?? f3 0f 2c c0 83 f8 01 7e 0f 83 f8 07 7c 16 b8 07 00 00 00 48 83 c4 28 c3 b8 01 00 00 00 48 83 c4 28 c3 33 c0 48 83 c4 28 c3";
/// Displacement offsets in PERCENT and the double each must reference, in order.
const POLYNOMIALS: [(usize, f64); 9] = [
    (0x1b, 0.0056),
    (0x27, 2.55),
    (0x33, 286.56),
    (0x74, 0.0016),
    (0x80, 0.8022),
    (0x8c, 107.78),
    (0xc9, 0.0000165),
    (0xd5, 0.0283),
    (0xe1, 12.6),
];

fn pattern(text: &str) -> Vec<Option<u8>> {
    text.split(' ')
        .map(|b| (b != "??").then(|| u8::from_str_radix(b, 16).unwrap()))
        .collect()
}

struct Image<'a> {
    bytes: &'a [u8],
    /// (virtual address, file-backed size, raw file offset, virtual size)
    sections: Vec<(usize, usize, usize, usize)>,
    text: usize,
}
impl<'a> Image<'a> {
    fn parse(bytes: &'a [u8]) -> Option<Self> {
        let u16_at = |at: usize| Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?));
        let u32_at =
            |at: usize| Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize);
        let pe = u32_at(0x3c)?;
        // PE32+ for x86-64 only.
        if bytes.get(..2)? != b"MZ"
            || bytes.get(pe..pe + 4)? != b"PE\0\0"
            || u16_at(pe + 4)? != 0x8664
        {
            return None;
        }
        let count = u16_at(pe + 6)? as usize;
        let first = pe + 24 + u16_at(pe + 20)? as usize;
        let mut sections = vec![];
        let mut text = None;
        for i in 0..count {
            let s = first + i * 40;
            let (size, va, raw_size, raw) = (
                u32_at(s + 8)?,
                u32_at(s + 12)?,
                u32_at(s + 16)?,
                u32_at(s + 20)?,
            );
            if bytes.get(s..s + 8)? == b".text\0\0\0" {
                text = Some(sections.len());
            }
            // Only the part backed by file bytes is readable here.
            sections.push((va, size.min(raw_size), raw, size));
        }
        Some(Self {
            bytes,
            sections,
            text: text?,
        })
    }
    /// A global outside code: file-backed or zero-filled part of a data section.
    fn global(&self, rva: usize) -> bool {
        let (text_va, _, _, text_size) = self.sections[self.text];
        !(text_va..text_va + text_size).contains(&rva)
            && self
                .sections
                .iter()
                .any(|&(va, _, _, size)| (va..va + size).contains(&rva))
    }
    fn at(&self, rva: usize, n: usize) -> Option<&'a [u8]> {
        let &(va, size, raw, _) = self
            .sections
            .iter()
            .find(|(va, size, ..)| (*va..*va + *size).contains(&rva))?;
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
    let (text_va, text_size, text_raw, _) = image.sections[image.text];
    let anchor = pattern(ANCHOR);
    let code = image.bytes.get(text_raw..text_raw + text_size)?;
    let mut getters = vec![];
    for i in 0..code.len().saturating_sub(anchor.len()) {
        let rva = text_va + i;
        // Cheap prefilter before the full masked comparison.
        if code[i] != 0xe8
            || code[i + 5] != 0xb9
            || code[i + 6] != 0x96
            || !image.matches(rva, &anchor)
        {
            continue;
        }
        let name = image.at(image.target(rva + 20)?, 16)?;
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
    let (root, correction, percent) = (
        image.target(getter + 0x14)?,
        image.target(getter + 0x7c)?,
        image.target(getter + 0x72)?,
    );
    if image.target(getter + 0x87)? != percent || !image.matches(correction, &pattern(CORRECTION)) {
        return None;
    }
    let (clock, math) = (
        image.target(correction + 0x46)?,
        image.target(correction + 0xb4)?,
    );
    let constants = image.f32_at(correction + 0x8a)? == 0.3
        && image.matches(math, &pattern(MATH))
        && image.f32_at(math + 0x14)? == 86400.0
        && image.f32_at(math + 0x98)? == 0.5
        && image.matches(percent, &pattern(PERCENT));
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
            (GETTER, 0x8b),
            (CORRECTION, 0xcc),
            (MATH, 0xb9),
            (PERCENT, 0x118),
            (ANCHOR, 24),
        ] {
            assert_eq!(pattern(text).len(), len);
        }
        for &(field, _) in &POLYNOMIALS {
            assert!(pattern(PERCENT)[field..field + 4]
                .iter()
                .all(Option::is_none));
        }
        assert!(locate(b"MZ").is_none());
    }

    /// `ANCIENT_CLIENT_DLL=<…/win64/client.dll> cargo test -- --ignored --nocapture` on any
    /// installed build. Addresses move with every patch (the researched build had the getter at
    /// 0x2c54010, root 0x5ba3bd0, clock 0x65aca1c), so they are printed, not compared.
    #[test]
    #[ignore]
    fn installed_client_layout_is_found_and_fails_closed() {
        let path = std::env::var("ANCIENT_CLIENT_DLL").expect("ANCIENT_CLIENT_DLL");
        let mut bytes = std::fs::read(path).unwrap();
        let layout = locate(&bytes).expect("layout");
        eprintln!(
            "getter {:#x}, root {:#x}, clock {:#x}",
            layout.getter, layout.root, layout.clock
        );
        // A changed formula constant (0.0056 → other) must fail closed.
        let image = Image::parse(&bytes).unwrap();
        let percent = image.target(layout.getter + 0x72).unwrap();
        let constant = image.target(percent + 0x1b).unwrap();
        let &(va, _, raw, _) = image
            .sections
            .iter()
            .find(|(va, size, ..)| (*va..*va + *size).contains(&constant))
            .unwrap();
        bytes[raw + constant - va] ^= 1;
        assert!(locate(&bytes).is_none());
    }
}
