import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'NoutyNotes',
  slug: config.slug ?? 'noutynotes',
  experiments: {
    ...config.experiments,
    baseUrl: process.env.NOUTYNOTES_PAGES === '1' ? '/NoutyNotes' : '',
  },
});
