import { TestBed } from '@angular/core/testing';

import { FakeDownloadStorage, FakePreferences, TEST_FOLDER, provideFakeDownloads } from '../testing/fake-download-storage';
import { DownloadFolderService } from './download-folder.service';

import { describe, beforeEach, it, expect, afterEach, vi } from 'vitest';

describe('DownloadFolderService', () => {
  let storage: FakeDownloadStorage;
  let preferences: FakePreferences;

  function setUp(folderChosen = false) {
    TestBed.configureTestingModule({ providers: [provideFakeDownloads(storage, preferences, folderChosen)] });
    return TestBed.inject(DownloadFolderService);
  }

  beforeEach(() => {
    storage = new FakeDownloadStorage();
    preferences = new FakePreferences();
  });

  it('on Android, needs a folder until one is picked, and keeps it on this device', async () => {
    const folders = setUp();
    await folders.load();
    expect(folders.needsPicking).toBe(true);
    expect(folders.ready()).toBe(false);

    await folders.pick();
    expect(folders.ready()).toBe(true);
    expect(folders.folder()).toEqual(TEST_FOLDER);
    expect(folders.root()).toBe(TEST_FOLDER.uri);
    expect(JSON.parse(preferences.values.get('download_folder')!)).toEqual(TEST_FOLDER);
  });

  it('restores the picked folder on the next start', async () => {
    const folders = setUp(true);
    await folders.load();
    expect(folders.folder()).toEqual(TEST_FOLDER);
  });

  it('forgets the folder if access was lost', async () => {
    storage.accessible.clear();
    const folders = setUp(true);
    await folders.load();
    expect(folders.ready()).toBe(false);
  });

  it('ignores a broken saved value', async () => {
    preferences.values.set('download_folder', '{nope');
    const folders = setUp();
    await folders.load();
    expect(folders.folder()).toBeNull();
  });

  it('needs nothing on iOS, where downloads go to the app folder in Files', async () => {
    storage = new FakeDownloadStorage('files-app');
    const folders = setUp();
    await folders.load();
    expect(folders.needsPicking).toBe(false);
    expect(folders.ready()).toBe(true);
    expect(folders.root()).toBeNull();
  });
});
