package com.teredatrades.bejirond;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TallyWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
