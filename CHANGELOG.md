# Changelog

All notable changes to this project are documented here.

## [Unreleased]

- Add future changes here before the next release.

## [0.2.1] - Preview

- Added last reported input token usage, model context limit, and utilization percentage to DTOC metadata.
- Included context usage on visible, hidden, and replaced tool outputs.
- Added coverage for usage refresh, empty assistant messages, session isolation, and provider lookup retries.

## [0.2.0] - Preview

- Added `replace` support to `manage_context`.
- Added replacement metadata and character counts.
- Added agent guidance for choosing `disable`, `enable`, and `replace`.
- Added a reminder to batch related context changes where practical.
- Added validation for conflicting actions on the same tool key.
- Added release and installation documentation.
