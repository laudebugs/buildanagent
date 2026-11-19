# Writes the book's served fonts: WOFF2 subsets of the upstream files that scripts/fetch-fonts.mjs downloaded, with
# each family's OFL.txt beside them. Run it from apps/manual with the pinned fontTools, passing the upstream folder
# and the output folder as arguments so no code loads from either:
#
#   uv run --no-project --with fonttools==4.68.0 --with brotli==1.2.1 \
#     python -I scripts/subset-fonts.py fonts/sources.json fonts/upstream public/fonts
#
# fonts/sources.json lists the families, their files and their served names.
#
# A subset is a Modified Version under the SIL Open Font License 1.1. None of the three licences names a Reserved Font
# Name, but Google Sans Code's TRADEMARKS.md keeps the "Google" mark off modified versions, so its subsets get the
# neutral family name "Manual Code" in their file names and in their name tables, and lose Google's vendor id. The
# copyright, trademark notice, designer and licence records stay as the OFL requires.
import json
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

# Latin-1 and Latin Extended-A, punctuation, arrows, maths, box drawing, shapes and check marks. A font keeps only the
# code points it has, and a chapter that needs more widens this list and reruns the script.
UNICODES = (
    "U+0000-017F,U+0192,U+0218-021B,U+02BB-02BC,U+02C6-02DC,U+1E9E,U+2000-206F,U+2070-2079,U+20AC,U+2122,"
    "U+2190-21FF,U+2212,U+2215,U+221E,U+2248,U+2260-2265,U+2500-257F,U+25A0-25FF,U+2713-2717,U+FB01-FB02,U+FEFF,U+FFFD"
)
# Beside the subsetter's default features (kerning, ligatures, marks), keep the figure styles and the slashed zero.
EXTRA_FEATURES = ["tnum", "lnum", "onum", "pnum", "case", "zero"]

# Name records that identify the font itself; the others (copyright, trademark notice, designer, licence) stay.
IDENTITY_NAME_IDS = {1, 3, 4, 6, 16, 18, 21, 25}
# Records that point at Google as the source of this version; a modified version drops them.
SOURCE_NAME_IDS = {8, 11}


def neutral_names(font: TTFont, original: str, neutral: str) -> None:
    """Renames a subset to its neutral family name, as Google Sans Code's TRADEMARKS.md requires of modified versions."""
    name = font["name"]
    compact = (original.replace(" ", ""), neutral.replace(" ", ""))
    name.names = [record for record in name.names if record.nameID not in SOURCE_NAME_IDS]
    for record in name.names:
        if record.nameID in IDENTITY_NAME_IDS or record.nameID >= 256:
            text = record.toUnicode().replace("GOOG;", "")
            record.string = text.replace(original, neutral).replace(*compact)
    font["OS/2"].achVendID = "NONE"
    # A real check, not an assert, so it still runs under python -O; test/fonts.test.ts reads the shipped names too.
    for record in name.names:
        if (record.nameID in IDENTITY_NAME_IDS or record.nameID >= 256) and "Google" in record.toUnicode():
            raise ValueError(f"name record {record.nameID} still reads {record.toUnicode()!r}")


def write_subset(source: Path, target: Path, rename: tuple[str, str] | None) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = [*options.layout_features, *EXTRA_FEATURES]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    font = subset.load_font(str(source), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    if rename:
        neutral_names(font, *rename)
    target.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(target), options)
    print(f"{target}  {target.stat().st_size} bytes")


def main() -> None:
    manifest, upstream, output = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    for family in json.loads(manifest.read_text())["families"]:
        source, target = upstream / family["upstream"], output / family["folder"]
        rename = None
        if family["neutralName"]:
            rename = (TTFont(source / family["fonts"][0]["upstream"])["name"].getBestFamilyName(), family["neutralName"])
        for font in family["fonts"]:
            write_subset(source / font["upstream"], target / font["served"], rename)
        for file in family["licences"]:
            shutil.copyfile(source / file, target / file)


if __name__ == "__main__":
    main()
