// ROLLBACK INSTRUCTIONS:
// To disable passport for any restaurant, change entryExperience: 'passport'
// to entryExperience: 'default' for that restaurant's entry below.
// Commit and push to main. Vercel auto-deploys in ~60 seconds.
// Customers immediately see original name-input flow on next QR scan.
// No data loss: localStorage keys remain so re-enabling restores returning customer recognition.
//
// To fully remove passport feature: delete PassportEntry.tsx, PassportEntry.css,
// and remove this restaurant entry. Parent component falls back to default automatically.

export interface PassportConfig {
  visitorBaseOffset: number;
  stampText: string;
}

export interface RestaurantConfig {
  displayName: string;
  entryExperience: 'passport' | 'default';
  passportConfig?: PassportConfig;
}

const restaurantConfigs: Record<string, RestaurantConfig> = {
  'cafe-muziris': {
    displayName: 'Cafe Muziris',
    entryExperience: 'passport',
    passportConfig: {
      visitorBaseOffset: 1247,
      stampText: 'CAFE MUZIRIS / VISITED',
    },
  },
};

/**
 * Returns the config for a given restaurant slug.
 * If the slug is not found, returns a safe default with entryExperience: 'default'.
 * This ensures the app never crashes if a config entry is missing or deleted.
 */
export function getRestaurantConfig(slug: string): RestaurantConfig {
  return restaurantConfigs[slug] || {
    displayName: slug,
    entryExperience: 'default',
  };
}
