# Typeset: where the lines of a text may break

The browser breaks a line at any space and after any hyphen or dash. Typesetting decides which of those places a
reader should never see a line end at: «в | доме», «10 | км», «Dr. | Smith», «— » at the start of a line, «e- | mail».
This folder does that for the site's pages when they are built, for Russian and English, and the same code can run
anywhere a text is (a script's message, a Figma layer, a file on the command line, the review page of the system).

It was written for Flow Medium (`build/typeset/`, Oct 2026), where it replaced a regex typograph (FM's decision
`typeset` has the measured difference), and moved into the kit unchanged: on FM's four pages the kit's output is
byte-identical to FM's, and `--lint` lists the same 23 findings.

## Files

| file | what it is |
|---|---|
| `core.js` | the rules, on plain text, no dependencies (runs in Node, the browser, Figma's plugin code) |
| `words.js` | the word lists the rules read (prepositions, units, labels, honorifics…) |
| `html.js` | the rules on an HTML page: a real parser (parse5), texts joined across inline tags, the language of each block |
| `lint.js` | the visible characters a proofreader would change: reported, never changed by the build |
| `index.js` | the public API: `import { typesetHtml, typeset, lint } from "site-kit/typeset"` |
| `vite.js` | the Vite plugin: `import { typeset } from "site-kit/typeset/vite"` |
| `cli.mjs` | `site-kit typeset …` |
| `../test/typeset.test.mjs` | every rule as examples (`npm test` in the kit) |

## How it works

1. **Blocks.** `html.js` reads the page with parse5 and collects the text of every block (a `p`, `h1`–`h6`, `li`, `td`,
   `div`…). Inline tags (`a`, `span`, `b`, `em`…) are part of the block: «в <a>доме</a>» is one text. A `<br>` ends a
   text. `<template>` content is included (the cookie notice). Left alone: `script`, `style`, `svg`, `pre`, `code`,
   `kbd`, `samp`, `var`, `textarea`, `noscript`, `title`, `option` and the other raw-text elements, anything with
   `data-typeset="off"` or `contenteditable`, the `<head>`, and every attribute. Inside `data-typeset="spaces"`, and
   inside the elements a site's scripts split letter by letter (named in `typeset.spacesOnly`, e.g.
   `data-reveal=chars`), only no-break spaces are written, no invisible joiners.
   Text the parser does not keep as written (a stray end tag inside a sentence, a NUL) is left alone.
2. **Language.** Each block takes the nearest `lang` attribute (`<html lang="ru">`, a `<span lang="en">` inside it).
   `ru` and `en` have their own rules; any other language gets the rules for every language.
3. **Tokens.** The text is cut into words, numbers, spaces, punctuation, dashes, hyphens, signs, and whole pieces for
   links, e-mails and phones.
4. **One answer per space.** For every space the rules are asked in order; the first that has a view answers: *hold*
   (with a strength), *break*, or no view (the next rule is asked). Nothing is done in passes, so a chain like «а не в
   последний» is held word by word (the old typograph missed every second word of a chain).
5. **Joins.** Where two parts touch with no space but a browser may still break (after a hyphen or a dash), a hold is a
   word joiner (U+2060): invisible, and the real hyphen stays, so copying and searching still find «e-mail».
6. **No length limit.** A hold is never let go because the piece it makes is long (Tim, Oct 24, 2026). `site-kit
   typeset src/index.html` prints each text's longest piece in brackets, so a long one is easy to spot (on Flow
   Medium the longest are 19 letters on the home page and 18 in a heading of the privacy policy).
7. **In place.** Only the characters the rules decide on change, at their place in the source; entities (`&nbsp;`,
   `&laquo;`, `&#8209;`) and everything else stay exactly as written.

Strengths (recorded for each hold, shown by `site-kit typeset`): *author* 9 (a no-break space you typed: kept, except
next to a link) · *must* 3 · *should* 2 · *nice* 1.

GSAP's SplitText (checked Oct 24 on the real page and a test page, SplitText 3.15): it keeps every no-break space, and
lines split by it keep every hold. Three things to know for new texts: in a heading split letter by letter
(`typeset.spacesOnly`) a word joiner would become an empty animated letter, so none is written there; a hold right at
the edge of an inline tag («в <a>доме</a>») is lost in every split mode, since SplitText makes the tag's text a box of
its own, so keep links and other tags out of split headings; and a held group wider than the line in a letter-split
heading breaks between letters (each letter is its own box).

## The rules

Marks: `⍽` no-break space, `⁀` word joiner, `¦` a place a long link may break (`<wbr>`).

### Any language

| rule | strength | example |
|---|---|---|
| link-free | — | a word is never held to a link or an e-mail (they are long); a typed `&nbsp;` there is let go |
| author | 9 | a no-break space already in the text stays |
| copyright | must | `©⍽2026` |
| sign-number | must | `№⍽5`, `§⍽3`, `¶⍽49` |
| digit-groups | must | `10⍽000⍽000` |
| number-sign | must | `5⍽%`, `100⍽₽`, `20⍽°C` |
| currency-number | must | `$⍽100` |
| dash | should | `лейбл⍽— на одной волне`: a spaced dash never starts a line (a closed `word—word` is left as it is) |
| initials | must / should | `А.⍽С.⍽Пушкин`, `J.⍽R.⍽R.⍽Tolkien` (a chain: must); one initial before a word: should, since `план Б. Затем` may be a sentence end |
| last-word | nice | the last word of a text of 4+ words, if it has 3 letters or fewer, does not stand alone: `Напишите⍽нам`, `CEO`|
| range (join) | must | `2022–⁀2025`, `2-⁀11` |
| short-part (join) | should | `COVID-⁀19`, `1-⁀й`, `e-⁀mail`, `из-⁀за`, `кто-⁀то`, `кое-⁀как`; long parts still break: `Telegram-бот` |
| link breaks | — | `hello@¦flowmedium¦.pro`, `https://¦yandex¦.ru/¦legal/` (links of 16+ characters) |
| phone | must | `+7⍽(904)⍽512-⁀51-⁀50`, `(555)⍽123-⁀4567` are one piece |

### Russian (`lang="ru"`)

| rule | strength | example |
|---|---|---|
| particle | should | `сделал⍽бы`, `так⍽ли`, `он⍽же` |
| org | must | `ООО⍽«Ромашка»`, `ИП⍽Поплавский` |
| abbr-pair | must | `т.⍽е.`, `и⍽т.⍽д.`, `в⍽т.⍽ч.` |
| label-number | must | `ст.⍽6`, `п.⍽5`, `глава⍽3`, `в параграфе⍽3`, `ИНН:⍽7701…` (the number goes with its label, not with the next word: `3 Политики` breaks; a one-letter label only with its dot: `с 1 января` is not a page) |
| place | should | `г.⍽Москва`, `ул.⍽Тверская` (not `2006 г. В том году`) |
| century | must | `XX⍽в.`, `XIX⍽вв.` |
| amount-currency | must | `5⍽млн⍽руб.`, `10⍽тыс.⍽₽` |
| pointer | should | `см.⍽раздел`, `напр.⍽так` |
| name-initials | should | `Поплавский⍽М.⍽К.` |
| number-of-number | must | `3⍽из⍽5`, `4⍽из⍽10`: one piece |
| number-sign | must | a sign set apart from its number: `50⍽%`, `90⍽°`, `5⍽‰` |
| number-word | must / should | units, years, months: `10⍽км`, `27⍽июля`, `2006⍽г.`, `200⍽г` (must; one-letter units only with their dot, `в 2025 в Москве`, `5 с лишним`, but for `г м л ч`, which are no word: `200⍽г`, `5⍽м`, `2⍽л`, `3⍽ч`); what a number counts: `20⍽000⍽договоров` (should); never a capitalised word (`3 Политики`), a short word (`2026 и`) or after a label (`части⍽1 статьи`) |
| short-word | should | one- and two-letter words and `без для над под при про обо изо ото что как или меж ибо`: `в⍽доме`, `без⍽уточнений`, `а⍽не⍽в⍽последний`; not abbreviations in capitals (`РФ о`, `ПД (п. 1`), not particles, not the end of a hyphenated word (`кто-то из`); hyphenated prepositions count (`из-за⍽этого`) |

Sources: А. Э. Мильчин, Л. К. Чельцова, «Справочник издателя и автора» (no-break spaces after prepositions and
conjunctions, with numbers and units, initials, abbreviations); the rules of [Typograf](https://github.com/typograf/typograf)
(compared below).

### English (`lang="en"`)

| rule | strength | example |
|---|---|---|
| honorific | must | `Dr.⍽Smith`, `Mr⍽Smith`, `Prof.⍽Lee` |
| name-suffix | must | `Smith,⍽Jr.` |
| label-number | must | `Fig.⍽3`, `page⍽12`, `No.⍽5`, `Chapter⍽2`, `Art.⍽6` (a short lower-case label needs its dot: `no 5-star`) |
| month-day | must | `October⍽19`, `Oct.⍽19`, `19⍽October` |
| number-word | must / should | units: `9⍽am`, `9⍽a.m.`, `5⍽GB`, `10⍽km`, `30⍽min` (must); what is counted: `20,000⍽contracts` (should); not `2026 the`, not capitalised words |
| short-word | should / nice | `a`, `an`, `the`, `I` stay with the next word (`the⍽label`, `I⍽think`); in headings also `of to in on at by for and or nor but as if is it so up via per vs am are was be my our its` (nice) |

English is lighter than Russian on purpose: English typesetting does not forbid a line ending in «of» or «to» in
running text, and holding every small word makes lines more ragged. Sources: Matthew Butterick, *Practical Typography*,
«Nonbreaking spaces» (§ and ¶ references, «Fig. 23», honorifics, © and ™); *The Chicago Manual of Style* (numbers with
units, dates, initials); Robert Bringhurst, *The Elements of Typographic Style* (no line ending with a single-letter
word in display type).

## What the build reports instead of changing

`site-kit typeset --lint src/*.html` lists, with line and column:

| check | example | the fix it suggests |
|---|---|---|
| mixed-script | `сookie` (a Cyrillic с) | — (retype the word) |
| quotes | `"кавычки"` | `«кавычки»` in Russian (`„…“` inside), `“…”` in English (`‘…’` inside) |
| apostrophe | `it's` | `it’s` |
| ellipsis | `...` | `…` |
| hyphen-as-dash | `слово - слово` | `—` |
| double-hyphen | `--` | `—` |
| range | `2022-2025` | `2022–2025` (not dates `2026-10-19` or codes `512-51-50`) |
| times | `1920x1080` | `1920×1080` |
| number-sign | `№152` | `№⍽152` (Russian) |
| space-before | `слово ,` | `слово,` |

`--fix` writes the suggested fixes into the files (commit first; review with `git diff`).

## Command line

Run in the site's root (file paths are relative to it):

```
site-kit typeset src/index.html                  every text of the page with its holds and [its longest piece]
site-kit typeset --lint src/*.html               only the findings
site-kit typeset --fix src/privacy.html          the findings' fixes written into the file (commit first)
site-kit typeset --text "Dr. Smith on page 12" --lang en [--heading]
site-kit typeset --json src/index.html           everything as JSON
```

## The site's settings: `typeset` in `site-kit.config.mjs`

All optional; with none the typesetter behaves exactly as Flow Medium's did before the move, apart from letter-split
headings (below).

| field | what | default |
|---|---|---|
| `spacesOnly` | attributes `"name=value"` of the elements a script splits letter by letter: only no-break spaces there (FM: `["data-reveal=chars"]`, motion.js) | `[]` (`data-typeset="spaces"` always counts) |
| `off` | names of rules to leave out (`["last-word"]`) | `[]` |
| `lang` | the language of a text with no `lang` attribute around it | none: such a text gets only the rules for any language |
| `pages` | (Vite plugin) which pages: file names, a RegExp or a function of the path | every page |
| `warn` | (Vite plugin) `true`: one line per page with findings, first build only; `false`: silent; `"error"`: the build stops | `true` |

The word lists (prepositions, units, labels…) are the kit's, not a site's: a word missing for one site is missing for
all, so add it in `words.js` with a test.

## In a site

- **The build:** `import { typeset } from "site-kit/typeset/vite"` and `plugins: [typeset(), …]` in vite.config.js.
  With no options the plugin reads `typeset` from the site's `site-kit.config.mjs` (the build must run in the site's
  root, or set `SITE_KIT_ROOT`); `typeset({ … })` takes the same fields directly. Put it `order: "pre"` before other
  HTML plugins (it is), so it sees the page as written.
- **A script's text** (a dialog, a message): import the core alone, `import { typeset } from "site-kit/typeset/core.js"`
  (≈ 5 KB gzipped with the word lists; `site-kit/typeset` itself also exports html.js, which pulls in parse5). Then
  `el.textContent = typeset("Открыть запись", { lang: "ru" })`.
- **The review page** bundles `core.js` and `lint.js` (no Node imports in either: keep it so).
- **Figma**: `core.js` has no imports but `words.js`; pasted into `use_figma` together, `typeset(node.characters)`
  gives the layer the same breaks as the site.
- **Packages:** `html.js` needs `parse5` and `entities` (peer dependencies: the site's own node_modules).

## QQ's typograph (`build/typograph.js`) and the kit

QQ still runs the regex typograph Flow Medium had before Oct 19 (Russian rules on every text node, several passes).
Read side by side and run on sample texts (QQ's pages are generated and none were built here, so not on its pages):

What QQ would gain:
- **Texts across tags.** QQ's runs on each text node alone: «в <a>доме</a>» is never held. The kit joins a block's
  words across inline tags.
- **Whole chains.** The regex passes miss words of a chain: QQ gives «а⍽не в⍽последний», the kit «а⍽не⍽в⍽последний»
  (it answers every space once).
- **Languages.** QQ applies Russian rules to English text too (coffee names, «Ethiopia Yirgacheffe in a bag»);
  the kit follows `lang`.
- **Fewer wrong holds.** QQ holds any number to any word after it («в⍽2026⍽и⍽дальше», «3⍽Политики»); the kit only
  to units, months and counted things, never to a capital or a short word.
- **Joins and links:** `COVID-⁀19`, `кто-⁀то`, ranges, phones as one piece, `<wbr>` in long links and e-mails.
- **Source kept as written.** QQ decodes only five entities and re-encodes `&`, so a named entity it does not know is
  broken: `&laquo;да&raquo;` comes out `&amp;laquo;да&amp;raquo;` (shown as typed). The kit changes only the
  characters it decides on and leaves every entity as written.
- **The lint** (straight quotes, hyphens for dashes, look-alike letters), the command line, and the tests.

What QQ would lose or must check:
- **Line breaks move.** Every page wraps a little differently; run the audit (cut text, sideways scroll) and look at
  tight places (cards, buttons, the tab bar) after switching.
- **`<option>` text** is not touched by the kit (QQ's typograph did touch it); no visible change in a native select.
- **Two packages** (`parse5`, `entities`) and a slower build step: a full parser and the lint, 0.28 s for a 101 KB
  page against QQ's 0.03 s (measured on FM's privacy policy).
- QQ's scripts that write Russian text (the bag, favourites, dialogs) can use `core.js` in the browser to match.

## Fonts

Only U+00A0 (no-break space), U+2060 (word joiner, drawn as nothing) and `<wbr>` are written into pages. The site's
fonts have U+00A0; U+2060 is a default-ignorable character that browsers never draw, so it needs no glyph. The narrow
no-break space (U+202F), which Russian rules use between digit groups, is not in Golos or Pragmatica Ext, so digit
groups get the ordinary no-break space.
