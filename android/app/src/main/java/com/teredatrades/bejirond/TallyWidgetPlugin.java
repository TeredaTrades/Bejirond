package com.teredatrades.bejirond;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Local (app-embedded, not published) Capacitor plugin backing Settings > Quick Access:
 *  - updateBalance: pushes a short summary string into the Home screen widget.
 *  - hasOverlayPermission / requestOverlayPermission / startBubble / stopBubble: the
 *    floating icon, which needs the "display over other apps" permission.
 *  - requestPinWidget: best-effort prompt to add the widget without leaving the app.
 *
 * Every method fails soft — this feature should never be able to crash or block the
 * rest of the app, so all of them catch broadly and return a plain result object.
 */
@CapacitorPlugin(name = "TallyWidget")
public class TallyWidgetPlugin extends Plugin {

    public static final String PREFS_NAME = "tally_widget_prefs";
    public static final String KEY_BALANCE_TEXT = "balance_text";

    @PluginMethod
    public void updateBalance(PluginCall call) {
        String text = call.getString("text", "");
        try {
            Context ctx = getContext();
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_BALANCE_TEXT, text).apply();

            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            ComponentName provider = new ComponentName(ctx, ExpensesWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(provider);
            if (ids != null && ids.length > 0) {
                Intent update = new Intent(ctx, ExpensesWidgetProvider.class);
                update.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
                update.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
                ctx.sendBroadcast(update);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void requestPinWidget(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Context ctx = getContext();
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mgr.isRequestPinAppWidgetSupported();
            ret.put("supported", supported);
            if (supported) {
                ComponentName provider = new ComponentName(ctx, ExpensesWidgetProvider.class);
                mgr.requestPinAppWidget(provider, null, null);
            }
        } catch (Exception e) {
            ret.put("supported", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void hasOverlayPermission(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                    || Settings.canDrawOverlays(getContext());
            ret.put("value", granted);
        } catch (Exception e) {
            ret.put("value", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Context ctx = getContext();
                Intent intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + ctx.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            }
        } catch (Exception e) { /* best effort — user can also grant this from device Settings directly */ }
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void startBubble(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Context ctx = getContext();
            boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
            if (!granted) {
                ret.put("started", false);
                call.resolve(ret);
                return;
            }
            Intent svc = new Intent(ctx, BubbleService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(svc);
            } else {
                ctx.startService(svc);
            }
            ret.put("started", true);
        } catch (Exception e) {
            ret.put("started", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void stopBubble(PluginCall call) {
        try {
            Context ctx = getContext();
            ctx.stopService(new Intent(ctx, BubbleService.class));
        } catch (Exception e) { /* ignore */ }
        call.resolve(new JSObject());
    }
}
