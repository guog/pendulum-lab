---
name: Pendulum Lab
description: Minimal Chinese engineering workbench for browser-local cart-pole experiments.
colors:
  accent: '#146759'
  accent-hover: '#0b5044'
  accent-active: '#063e34'
  ink: '#1f3430'
  muted: '#52645f'
  page: '#f3f5f2'
  surface: '#ffffff'
  line: '#d9e0da'
  secondary-border: '#aebdb5'
  secondary-hover: '#edf3ef'
  text-hover: '#e8eeea'
  field-border: '#acbcb3'
  field-hover-border: '#557a6c'
  field-disabled: '#f4f6f3'
  link: '#126655'
  selection-background: '#c9e1d7'
  selection-text: '#173b31'
  status-background: '#e2eee7'
  status-text: '#235e4d'
  configuration-background: '#e9eeea'
  recording-text: '#79500b'
  notice-background: '#fff5dc'
  notice-text: '#74500e'
  error-background: '#f9e6e0'
  error-text: '#852f1d'
  x: '#315f9e'
  v: '#08776b'
  theta: '#996018'
  omega: '#8255a1'
  rod: '#426d60'
  weight: '#d7a34c'
  center-stroke: '#314d44'
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
  headline:
    fontSize: '26px'
    fontWeight: 650
    letterSpacing: '-0.025em'
  identity:
    fontSize: '15px'
    fontWeight: 650
  section-heading:
    fontSize: '14px'
    fontWeight: 650
  label:
    fontSize: '13px'
  annotation:
    fontSize: '12px'
    lineHeight: 1.7
  micro:
    fontSize: '11px'
  clock:
    fontSize: '21px'
    fontWeight: 600
  button:
    fontWeight: 600
rounded:
  status: '5px'
  control: '6px'
  panel: '12px'
spacing:
  action-gap: '8px'
  compact-gap: '10px'
  inset-sm: '12px'
  chart-gap: '14px'
  inset-md: '16px'
  section-gap: '18px'
  panel-inset: '20px'
  signals-gap: '24px'
  workbench-gap: '28px'
  page-inset: '36px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.surface}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: '8px 16px'
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
  button-primary-active:
    backgroundColor: '{colors.accent-active}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: '8px 16px'
  button-secondary-hover:
    backgroundColor: '{colors.secondary-hover}'
  button-text:
    backgroundColor: 'transparent'
    textColor: '{colors.muted}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: '8px 16px'
  button-text-hover:
    backgroundColor: '{colors.text-hover}'
    textColor: '{colors.ink}'
  select:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '7px 32px 7px 10px'
    width: '100%'
  status:
    backgroundColor: '{colors.status-background}'
    textColor: '{colors.status-text}'
    typography: '{typography.label}'
    rounded: '{rounded.status}'
    padding: '7px 11px'
  apparatus:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.panel}'
  signal:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.panel}'
    padding: '14px 15px 8px'
  notice:
    backgroundColor: '{colors.notice-background}'
    textColor: '{colors.notice-text}'
    typography: '{typography.annotation}'
    rounded: '{rounded.control}'
    padding: '12px'
  error:
    backgroundColor: '{colors.error-background}'
    textColor: '{colors.error-text}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '12px 16px'
---

# Design System: Pendulum Lab

## Overview

The implemented interface is a minimal, restrained engineering workbench. A pale neutral page, white plotting surfaces, dark green text, and a single action accent keep attention on controls, the physical apparatus, and measured values. This documents the current implementation; no brand metaphor or additional visual identity has been selected.

The desktop composition groups experiment settings and evidence controls beside the running experiment. Compact typography, explicit units, stable numeric alignment, and visible state descriptions make the workbench readable without decorative elevation.

**Key Characteristics:**

- Restrained green action accent with separate colors for the four measured signals.
- Flat white measurement surfaces on a pale page, separated by thin borders.
- Compact Chinese labels, explicit units, and tabular numeric readouts.

## Colors

### Primary

The green `accent` identifies the principal action, the small identity drawing, and keyboard focus. Its hover and active variants darken the same action. The underlined link color is a closely related green.

### Neutral

`page` provides the pale background; `surface` provides white controls and measurement panels. `ink` carries primary text, `muted` carries descriptions and units, and `line` separates structural regions. Secondary controls and selects retain their distinct border and hover tokens. Configuration disclosure uses its own subdued background. Text selection has an explicit background and foreground pair.

### Measurement and state colors

The four signal tokens map consistently to sliding position (`x`), sliding velocity (`v`), accumulated angle (`theta`), and angular velocity (`omega`). These colors appear in both numeric outputs and their corresponding traces. They identify data series rather than interactive priority. The apparatus legend uses separate rod, weight, and center-stroke tokens that match the drawing.

The status pair marks the current run state. Recording text, the scope notice pair, and the error pair communicate distinct evidence or failure messages, always with explanatory text. No synthetic tonal ramps are part of the implementation.

## Typography

The interface uses the system sans-serif stack in `typography.body`, including Chinese system fallbacks. There is no downloaded display font. Buttons and selects inherit the surrounding font; the configuration disclosure uses the browser monospace `pre` face. The body has no explicit font-size or line-height override.

The main heading uses `headline`; section headings use `section-heading`; the identity uses `identity`. Sidebar text and the run-state label use `label`. Explanations and panel metadata use compact annotation text; the longer explanations and scope notice use the annotation line height. Footer text, chart units, legends, and configuration text use the micro size. Configuration text has a separate line height (1.6).

The clock uses `clock`. Parameter values, signal outputs, the clock, and experiment-footer values use tabular numerals. Signal outputs are semibold (600); footer numeric values use a lighter weight (500). Canvas axes are drawn with a system sans-serif face at a smaller size (10px).

## Layout

The header is a single horizontal row (66px high). Main content is centered with a maximum width (1600px), desktop side insets from `page-inset`, and top/bottom padding (28px / 20px). The title row places the heading and description opposite a compact status label, with a bottom gap (26px).

The desktop workbench has a fixed settings column (258px), a flexible experiment column, and `workbench-gap`. A thin vertical rule and right inset (26px) separate the settings. The toolbar places grouped controls opposite the simulation clock. The apparatus panel is followed by a two-column signal grid using `chart-gap`. The apparatus SVG has a fixed rendered height (305px); each plot canvas has a fixed CSS height (134px) and fills its panel width. These dimensions describe viewports, not physical scaling claims.

At the existing intermediate breakpoint (max-width: 1150px), main side insets become smaller (24px), the settings column narrows (225px), the workbench gap shrinks (20px), and the toolbar stacks with the clock aligned right. At the existing narrow breakpoint (max-width: 760px), the settings and charts become single-column, the sidebar divider becomes horizontal, actions can wrap, the secondary header note is hidden, and the main heading becomes smaller (23px). The body retains a minimum width (360px).

The reviewed operating context is desktop Chrome. Narrow-screen rules exist in CSS; mobile testing was excluded and these rules do not establish validated mobile support.

## Elevation & Depth

There are no box shadows, gradients, floating cards, or blur effects in the implemented stylesheet. White surfaces, pale background fills, thin borders (1px), and whitespace provide structure. The settings area is divided by a rule rather than placed inside a raised panel.

## Shapes

Controls, configuration blocks, notices, and error messages use `rounded.control`; the run-state label uses `rounded.status`; apparatus and signal containers use `rounded.panel`. Measurement panels clip to their rounded boundary where implemented. The apparatus legend deliberately uses different simple marks: a short rod line, a circular weight, and a square center marker. These marks correspond to the physical drawing rather than generic badges.

## Components

### Buttons

The primary button is solid accent with white text; secondary actions use a white fill, dark text, and a subdued border; the text action uses muted text and a transparent background and border. Buttons have a minimum height (40px). Their common padding, weight, and corner shape are recorded in frontmatter. The full-width evidence-export button uses the secondary variant.

The primary hover and active backgrounds darken. Secondary hover uses its pale fill; text-button hover adds a pale fill and darkens its text. The inherited active background rule also applies to secondary and text variants. Disabled buttons use reduced opacity (0.45) and a not-allowed cursor, and are excluded from the hover and active rules.

All keyboard-focusable controls and links receive the shared visible focus outline (3px solid accent, offset 3px). The skip link becomes visible at the top of the viewport when focused. Button background changes use a short transition (160ms ease-out), disabled under `prefers-reduced-motion: reduce`. There is no decorative transform animation.

### Fields and disclosures

Native selects fill the settings width, have the shared control shape and minimum height, and reserve extra right padding for the browser’s selector arrow. Hover strengthens their border. Disabled selects use muted text and a pale fill. Native file input styling is deliberately limited to width, small text, and muted color; the browser supplies the file-picker control. There is no custom text-entry field.

Native `details` / `summary` disclosures group full configuration and download/file-check options. Summary text is small and muted, becomes accent on hover, and uses the shared keyboard-focus outline. Expanded configuration is wrapped, scrollable monospace text with a maximum height (320px).

### Status and messages

The run state is a compact, noninteractive label with the status foreground/background pair and no text wrapping. It is not a filter chip. The evidence state is inline text. Scope notices and errors have separate semantic colors and explanatory copy; errors are exposed as alerts. These are the implemented states, not a generalized badge or toast library.

### Measurement containers

The apparatus panel has a white fill, thin line border, rounded corners, an inset heading, the SVG physical view, and a legend. Signal panels use the same surface language with compact padding. Each caption pairs a signal name and unit with a semibold, color-coded tabular value. A canvas below shows sampled data, axes, and either the current trace or a text placeholder. No chart library, tooltip, tab system, or chart interaction is implied by these containers.

### Header and footers

The header contains the inline SVG identity and a small operating-mode note. It is not a multi-page navigation bar. Experiment metadata and page notes wrap as needed, use small muted text, and are separated through spacing or a thin rule.

## Do's and Don'ts

### Do

- **Do** preserve each signal’s color across its readout and plotted trace.
- **Do** use the shared accent outline for keyboard focus and retain the visible skip link.
- **Do** keep units and descriptive text alongside color-coded measurements.
- **Do** use the existing control and panel shapes when extending the implemented workbench.

### Don't

- **Don't** use the signal colors as interchangeable action accents.
- **Don't** replace text status, warnings, or errors with color alone.
- **Don't** describe the existing narrow-screen CSS as validated mobile support.
- **Don't** introduce an invented brand metaphor, tonal ramp, or component into this record of the current implementation.

This record was extracted from the implemented HTML, stylesheet, and visualization source, with desktop screenshots reviewed. It records existing visual behavior and does not claim mobile validation or introduce a new visual identity.

Assisted-by: LLM
AI-Agent: OpenAI Codex
