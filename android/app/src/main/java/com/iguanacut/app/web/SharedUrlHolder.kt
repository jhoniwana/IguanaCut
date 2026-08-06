package com.iguanacut.app.web

/**
 * URL compartida hacia la app (Share intent desde Instagram/otras apps).
 * MainActivity la deposita al recibir ACTION_SEND; el bridge la entrega a
 * la web (una sola vez) y la limpia.
 */
object SharedUrlHolder {
    @Volatile
    var pendingUrl: String? = null
}
