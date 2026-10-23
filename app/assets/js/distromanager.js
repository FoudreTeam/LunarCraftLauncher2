const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
// exports.REMOTE_DISTRO_URL = 'https://www.dropbox.com/s/rd1hdqd9zji3x5k/LunarCraftLauncher.json?dl=1'
exports.REMOTE_DISTRO_URL = 'http://54.36.182.246:25568/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api