<p align="center">
  <img src="resources/icon-only.png" alt="nMangaloide logo" width="160" height="160" />
</p>

<h1 align="center">nMangaloide</h1>

<p align="center">
  An unofficial Android and iOS app for browsing, reading and downloading galleries from nhentai.net through its public API.
</p>

## Features

### Browsing

- **Browse and search**: newest galleries in an infinite grid, a search bar in the header, and one-tap searches for a gallery's tags, artists or groups.
- **Sorting**: sort the home page and searches by most recent, or by popularity today, this week, this month or of all time.
- **Tag filters**: enable or exclude tags on the Tags page to filter the home page permanently.
- **Gallery previews**: a gallery's page shows thumbnails of all its pages, so you can jump straight to any of them. Downloaded comics use the saved files as thumbnails, so they work offline.
- **Language flags**: Japanese, Chinese and English galleries are marked on their cards.
- **Navigation**: a bottom bar for Home, Tags, Favorites and Downloaded, a menu button for Downloading and Settings, and the system back button and iOS swipe-back gesture work as expected.

### Reading

- **Two reading modes**: infinite vertical scroll or one page at a time.
- **Double tap to zoom**: double tap a page to zoom in on that spot, and again to zoom back out.

### Favorites and account

- **Favorites**: saved on the device with their details and cover, so they show offline.
- **Account sync**: add your nhentai API key in Settings › Account (create one at nhentai.net › Settings › API keys) and your favorites stay in sync both ways between the device and your account. The sync runs in the background, respects the API's rate limits, shows its progress in Settings, and syncs again when you come back to the app.

### Downloads

- **Background downloads**: comics download in the background with a progress notification, and keep going with the screen off.
- **Portable CBZ files**: each comic is saved as one CBZ file (with `ComicInfo.xml`) that other comic reader apps can open too, in a folder you choose on Android or in the Files app on iOS. Copy the folder to another phone to take them with you.

### App

- **Backups**: export and import favorites, tags and settings as a JSON file, saved to the device or shared.
- **Privacy**: an encrypted local database, and the app's content is hidden in the app switcher.
- **Themes**: system, light, dark and OLED black.
- **17 languages**: English, Spanish, Catalan, French, German, Portuguese, Russian, Ukrainian, Bulgarian, Finnish, Danish, Norwegian Bokmål, Swedish, Polish, Japanese, Simplified and Traditional Chinese. The app picks your device's language on first launch, and you can change it in Settings.

## Building

```bash
npm install
```

```bash
npm run ionic:android
```

```bash
npm run ionic:ios
```

To build an unsigned iOS `.ipa` without an Apple developer account (to sign and install with AltStore, SideStore, Sideloadly or TrollStore):

```bash
npm run ios:ipa
```

## License

[GNU General Public License v3.0](LICENSE)
