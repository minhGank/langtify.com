const { withEntitlementsPlist } = require('expo/config-plugins');

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withEntitlementsPlist(config, (mod) => {
    // Personal Team development builds cannot provision the push entitlement.
    delete mod.modResults['aps-environment'];
    return mod;
  });
