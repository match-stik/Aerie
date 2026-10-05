// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
package com.aerie.phone;

import android.service.notification.NotificationListenerService;

/**
 * Deliberately does nothing.
 *
 * Android will not let an app read the list of what is currently playing unless
 * it owns an ENABLED NotificationListenerService — MediaSessionManager takes
 * that service's ComponentName as proof of the grant. So this class exists
 * purely as the key to that door.
 *
 * It overrides nothing: no notification is read, none is stored, and none is
 * sent anywhere. The grant is broad because Android made it broad; what this
 * house does with it is narrow on purpose, and the narrowness has to live
 * somewhere a person can check. It lives here, in an empty file.
 */
public class AerieNotificationListener extends NotificationListenerService {
}
