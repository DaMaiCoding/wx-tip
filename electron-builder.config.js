/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const path = require('path');

const PRODUCT_NAME = process.env.PRODUCT_NAME || "wxTip";
const APP_ID = process.env.APP_ID || "com.wxtip.app";

module.exports = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  directories: {
    output: "dist",
    buildResources: "assets"
  },
  files: [
    "src/**/*",
    "assets/icon.ico",
    "assets/icon.png",
    "package.json"
  ],
  extraResources: [
    {
      from: "src/main/services",
      to: "services",
      filter: [
        "**/*",
        "!**/*.log",
        "!**/*.tmp"
      ]
    },
    {
      from: "assets/icon.png",
      to: "assets/icon.png"
    },
    {
      from: "assets/icon.ico",
      to: "assets/icon.ico"
    }
  ],
  win: {
    icon: process.env.APP_ICON_ICO || "assets/icon.ico",
    target: [
      {
        target: "nsis",
        arch: ["x64"]
      },
      {
        target: "portable",
        arch: ["x64"]
      }
    ],
    compression: "maximum",
    signAndEditExecutable: false,
    sign: null
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: PRODUCT_NAME,
    deleteAppDataOnUninstall: false,
    license: "LICENSE",
    artifactName: "${productName}-${version}-setup.${ext}"
  },
  portable: {
    artifactName: "${productName}-${version}-portable.${ext}"
  },
  mac: {
    icon: process.env.APP_ICON_PNG || "assets/icon.png",
    target: ["dmg"]
  },
  linux: {
    icon: process.env.APP_ICON_PNG || "assets/icon.png",
    target: ["AppImage"]
  },
  electronDownload: {
    mirror: "https://npmmirror.com/mirrors/electron/"
  },
  publish: {
    provider: "github",
    owner: "DaMaiCoding",
    repo: "wx-tip"
  }
};
