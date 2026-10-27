// Lets the development build install next to the normal app (different package and name).
// EAS sets APP_VARIANT per build profile in eas.json. Base settings live in app.json.
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEV ? 'Money Tracker (Dev)' : config.name,
  android: {
    ...config.android,
    package: IS_DEV ? 'com.gunas.moneytracker.dev' : config.android.package,
  },
});
