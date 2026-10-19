package com.alderaeney;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins must be registered before the bridge starts.
        registerPlugin(FileSaverPlugin.class);
        registerPlugin(DownloadFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
