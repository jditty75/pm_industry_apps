/**
 * CoreDeploymentSignalTriggers.js
 *
 * Lightweight time-based trigger installers for SLG Signal operating loop handlers.
 */

var CoreDeploymentSignalTriggers = {

  DEFAULT_MINUTES: 30,

  /**
   * @param {string} handlerName container-bound function name
   * @param {number=} everyMinutes
   * @return {{ ok: boolean, handlerName: string, everyMinutes: number }}
   */
  installPeriodicTrigger: function (handlerName, everyMinutes) {
    var minutes = everyMinutes || CoreDeploymentSignalTriggers.DEFAULT_MINUTES;
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function (t) {
      if (t.getHandlerFunction && t.getHandlerFunction() === handlerName) {
        ScriptApp.deleteTrigger(t);
      }
    });
    ScriptApp.newTrigger(handlerName)
      .timeBased()
      .everyMinutes(minutes)
      .create();
    Logger.log('CoreDeploymentSignalTriggers.installPeriodicTrigger: ' +
      handlerName + ' every ' + minutes + 'm');
    return { ok: true, handlerName: handlerName, everyMinutes: minutes };
  },

  /**
   * @param {Array<string>} handlerNames
   * @param {number=} everyMinutes
   * @return {Array<Object>}
   */
  installSlgOperatingLoopTriggers: function (handlerNames, everyMinutes) {
    handlerNames = handlerNames || [];
    return handlerNames.map(function (name) {
      return CoreDeploymentSignalTriggers.installPeriodicTrigger(name, everyMinutes);
    });
  }
};
