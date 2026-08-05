#!/usr/bin/env node

export function slugifyTitle(input = "", {maxLength} = {}) {
    const slug = transliterateLatin(String(input))
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^\p{Letter}\p{Number} -]+/gu, "")
        .toLowerCase()
        .replace(/ /g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");

    if (!Number.isInteger(maxLength) || maxLength < 1) {
        return slug;
    }

    return Array.from(slug).slice(0, maxLength).join("").replace(/-+$/g, "");
}

function transliterateLatin(value) {
    return value.replace(/[ąĄćĆęĘłŁńŃóÓśŚźŹżŻßøØæÆœŒ]/g, (character) => {
        switch (character) {
            case "ą": return "a";
            case "Ą": return "A";
            case "ć": return "c";
            case "Ć": return "C";
            case "ę": return "e";
            case "Ę": return "E";
            case "ł": return "l";
            case "Ł": return "L";
            case "ń": return "n";
            case "Ń": return "N";
            case "ó": return "o";
            case "Ó": return "O";
            case "ś": return "s";
            case "Ś": return "S";
            case "ź": return "z";
            case "Ź": return "Z";
            case "ż": return "z";
            case "Ż": return "Z";
            case "ß": return "ss";
            case "ø": return "o";
            case "Ø": return "O";
            case "æ": return "ae";
            case "Æ": return "AE";
            case "œ": return "oe";
            case "Œ": return "OE";
            default:
                return character;
        }
    });
}
