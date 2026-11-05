---
name: Appa
description: Flashcards, notes and PDFs, organized by class.
colors:
  sky-accent: "#2f6fd1"
  accent-ink: "#ffffff"
  paper: "#f5f4f0"
  page: "#fdfdfb"
  page-shade: "#f0efea"
  page-hover: "#ebe9e3"
  rule: "#e4e2da"
  rule-strong: "#d2cfc5"
  ink: "#191917"
  ink-soft: "#55534d"
  ink-faint: "#85827a"
  new-blue: "#2f6fd1"
  due-green: "#1f7a3a"
  again-red: "#c4362f"
  hard-amber: "#9a6200"
  night: "#111110"
  night-page: "#191918"
typography:
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "9px"
  md: "12px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.sky-accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-secondary:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  input-text:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: "34px"
  card-panel:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "22px"
---

# Design System: Appa

## Overview

**Creative North Star: "The Friendly Notebook"**

Appa is a well-kept study notebook: warm paper, tidy pages, and a few bright tabs that tell you where things are. The ground is a soft off-white paper (dark and tinted themes keep the same structure), surfaces sit one tone apart, and colour is saved for what means something: the one blue for the next action and new cards, green for what's due, red and amber for the ratings, and each class's own emoji or tinted letter mark.

It is friendly, not childish. Warmth lives in the small touches (a class's emoji, encouraging words, a rounded corner) while the layout stays calm, because students spend long sessions here. Pages are softly lifted off the paper rather than drawn on it: panels and cards carry a gentle shadow so they read as sheets on a desk.

Density is comfortable: an app people work in, with a persistent sidebar of classes and pages of panels, tables and grids.

**Key Characteristics:**
- Warm paper ground, white pages one tone up, hairline rules.
- One accent: Appa's sky blue, for the primary action, focus and new cards.
- Data colours carry meaning (new, due, again, hard) and are never decoration.
- Each class has a mark: its emoji, or its initial on a tint of its own hue.
- Softly lifted panels; dialogs lifted most.
- Themes swap the palette, never the structure.

## Colors

A warm neutral paper with a single sky-blue accent and a small, strict set of data colours.

### Primary
- **Appa Sky** (#2f6fd1): the primary button, focus rings, the selected state, new-card counts and links. Rare enough to point at the next thing to do.

### Neutral
- **Paper** (#f5f4f0): the app's ground, behind everything.
- **Page** (#fdfdfb): panels, cards, inputs and buttons.
- **Page Shade** (#f0efea) and **Page Hover** (#ebe9e3): a tone down for grouped rows, hover and quiet fills.
- **Rule** (#e4e2da) and **Rule Strong** (#d2cfc5): hairline borders and dividers; the stronger one for dashed drop zones and scrollbars.
- **Ink** (#191917), **Ink Soft** (#55534d), **Ink Faint** (#85827a): text, secondary text, and hints, labels and counts.
- **Night** (#111110) and **Night Page** (#191918): the dark theme's ground and page.

### Data
- **New Blue** (#2f6fd1), **Due Green** (#1f7a3a), **Again Red** (#c4362f), **Hard Amber** (#9a6200): card counts and review ratings, everywhere they appear.

### Named Rules
**The One Blue Rule.** The accent marks the next action, focus and new cards. Nothing else on a screen is blue for decoration.

**The Data Colours Mean Something Rule.** Green is due, blue is new, red is again, amber is hard. They are never used as ornament.

**The Class Mark Rule.** A class is recognised by its own emoji, or its initial on a pale tint of a hue from its name (`hsl(hue 60% 92%)` with `hsl(hue 45% 32%)` ink).

## Typography

**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui, -apple-system); the user can switch the app's font in Preferences.

**Character:** one humanist sans throughout, tightened slightly at heading sizes; warmth comes from words and marks, not from a display face.

### Hierarchy
- **Headline** (650, 24px, 1.2, -0.02em): a page's title (Today, a class's name, Preferences).
- **Title** (600, 17px, 1.3): panel and section headings.
- **Body** (400, 15px, 1.5): text, fields and buttons (14px on buttons).
- **Label** (500, 13px): hints, counts, table headings and metadata; numbers use tabular figures.

### Named Rules
**The Tabular Numbers Rule.** Counts, dates and intervals use tabular figures so columns of numbers line up.

## Layout

A persistent left sidebar (248px) holds the screens, the classes (each opening to its decks) and Statistics and Preferences at the foot. Content sits to the right in a column up to 1040px wide with 28px padding; the Grid notes editor and pages with a side panel run full width. Panels stack with 16px between them; inside, fields sit on an auto-fit grid of 220px minimum columns with 8-12px gaps.

Below 760px the sidebar stacks above the page and the column scrolls as one; below 900px side-by-side panes stack.

## Elevation & Depth

Softly lifted. Panels and cards sit on the paper with a gentle, warm shadow so they read as pages on a desk; dialogs and popovers are lifted most. Today the system is still mostly flat (hairline borders, no resting shadow), and new or changed surfaces should move toward the softly lifted look.

### Shadow Vocabulary
- **Pop** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.05), 0 12px 32px rgb(0 0 0 / 0.12)`): dialogs, popovers, the date picker.

### Named Rules
**The Sheets On A Desk Rule.** Resting surfaces get a soft, low shadow, never a hard or dark one; the strongest shadow belongs to whatever is floating above the page.

## Shapes

Gently rounded throughout: 9px on buttons and fields, 12px on cards and tiles, 14px on panels, and full pills for chips, tags and the address bar. Class marks are 10px-rounded squares. Borders are 1px hairlines; dashed 2px borders mean "drop or add something here".

## Components

### Buttons
- **Shape:** gently curved (9px).
- **Primary:** Appa Sky with white text and a faint inner top highlight; darkens slightly on hover.
- **Secondary:** a page-coloured button with a hairline border; the default for most actions.
- **Link:** text-only, for quiet actions (Open notes, Hide tools).
- **Press:** buttons scale down very slightly when pressed.

### Cards / Containers
- **Panel:** page colour, hairline rule, 14px corners, 22px padding.
- **Tiles** (class decks, notes, import choices): page colour, 12-14px corners, a hover that firms up the border.

### Inputs / Fields
- **Style:** page colour, hairline rule, 9px corners, 34px tall.
- **Focus:** the border turns Appa Sky with a soft sky ring.

### Navigation
- **Sidebar:** screen links with icons; the classes as a tree with their emoji, counts on the right, settings and add actions appearing on hover. The current item gets the page colour with a hairline outline.

### Class Mark (signature)
- A 36px (48px on a class's page) rounded square: the class's emoji, or its initial on a tint of its own hue.

## Do's and Don'ts

### Do:
- **Do** keep one blue: the primary action, focus and new cards.
- **Do** give a class its emoji or tinted initial wherever classes are listed.
- **Do** lift panels and cards softly off the paper; lift dialogs the most.
- **Do** keep counts in the data colours and in tabular figures.
- **Do** let warmth come from words, emoji and rounded corners, with calm layouts.

### Don't:
- **Don't** use the data colours (green, blue, red, amber) as decoration.
- **Don't** add hard or dark shadows, or shadows on every element.
- **Don't** change the structure between themes; themes only swap the palette.
- **Don't** make it childish: no cartoon clutter, bouncing motion or loud colour during study.
