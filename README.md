# README dailynotes-panel 

## Features

Adds a panel to list all daily notes, where the notes are named in either yyyyddmm or yyyy-mm-dd format. You can specify the folder where the notes are stored in the settings.

![Create DailyNote](/resources/create-daily-note.gif)

In addition adds a command to add the file name as a Title (at the cursor position)

## Commands

- `dailyNotes.refresh`: Open today's daily note
- `dailyNotes.openNote`: Add the name of the file as a heading, converting `-` & `_` to spaces and capitalizing each words
- `dailyNotes.addTitle`: Refresh daily notes Panel

## Extension Settings

This extension contributes the following settings:

*  `dailyNotes.folder`: The folder where your daily notes are stored.
*  `dailyNotes.dateFormat`: Date format for daily notes.

## Known Issues

- Today's note is not selected in the pane; when open

## Release Notes

Users appreciate release notes as you update your extension.

### 0.0.2

**Date:** 2024-12-15
**Notes:** 
- Fixed the readme file

### 0.0.1

**Date:** 2024-12-15
**Notes:** First release