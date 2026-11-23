// The first line of a test file that must stay offline. The gateway's setup blocks every request to a host other than
// your own machine, stops the run if a provider key is set and turns real model requests off.
// #region setup
import "@buildanagent/gateway/testing/setup";
// #endregion

/** The setup runs when this module loads, so a test can import this file and know the guards are on. */
export const OFFLINE = true;
