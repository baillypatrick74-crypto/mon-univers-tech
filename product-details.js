// Les durées sont les maxima constructeur, avec le protocole indiqué.
export const productDetails = {
  'samsung-galaxy-s24-128': {
    source: 'https://news.samsung.com/global/enter-the-new-era-of-mobile-ai-with-samsung-galaxy-s24-series',
    wifi: 6, wifiLabel: '6E', cellular: '5G', storageGB: 128, batteryMah: 4000,
    photo: {
      path: './assets/galaxy-s24.webp',
      author: 'C.Stadler/Bwag', license: 'CC BY-SA 4.0',
      source: 'https://commons.wikimedia.org/wiki/File:Samsung_Galaxy_S24,_Sperrbildschirm.JPG',
    },
  },
  'apple-iphone-16-128': {
    source: 'https://www.apple.com/fr/iphone-16/specs/',
    wifi: 7, cellular: '5G', storageGB: 128,
    batteryHours: 22, batteryUse: 'lecture vidéo',
    photo: {
      path: './assets/iphone-16.webp',
      author: 'Padgriffin', license: 'CC BY 4.0',
      source: 'https://commons.wikimedia.org/wiki/File:IPhone_16_Ultramarine_Rear.png',
    },
  },
  'xiaomi-redmi-note-14-5g-256': {
    source: 'https://www.mi.com/fr/product/redmi-note-14-5g/specs/',
    cellular: '5G', storageGB: 256, batteryMah: 5110,
  },
  'google-pixel-9-128': {
    source: 'https://support.google.com/pixelphone/answer/7158570?hl=en#Pixel9',
    wifi: 7, cellular: '5G', storageGB: 128, batteryMah: 4700,
  },
  'apple-macbook-air-m3-13-16-256': {
    source: 'https://support.apple.com/fr-fr/118551',
    wifi: 6, wifiLabel: '6E', storageGB: 256,
    batteryHours: 18, batteryUse: 'lecture vidéo dans l’app Apple TV',
  },
  'asus-zenbook-14-oled-ux3405ma-16-512': {
    source: 'https://www.asus.com/fr/laptops/for-home/zenbook/asus-zenbook-14-oled-ux3405/techspec/',
    wifi: 6, wifiLabel: '6E', storageGB: 512,
  },
  'sony-wh-1000xm5': {
    source: 'https://www.sony.com/electronics/support/wireless-headphones-bluetooth-headphones/wh-1000xm5/specifications',
    batteryHours: 30, batteryUse: 'lecture musicale avec réduction de bruit active',
  },
  'lg-ultragear-27gr75q-b': {
    source: 'https://www.lg.com/us/monitors/lg-27gr75q-b-gaming-monitor',
  },
};

export function productFeatures(product) {
  const details = productDetails[product.id] ?? {};
  return [
    details.wifi && `Wi-Fi ${details.wifiLabel ?? details.wifi}`,
    details.cellular,
    details.storageGB && `${details.storageGB} Go de stockage`,
    details.batteryMah && `${details.batteryMah.toLocaleString('fr-FR')} mAh (capacité typique)`,
    details.batteryHours && `Jusqu’à ${details.batteryHours} h (${details.batteryUse}, mesure constructeur)`,
  ].filter(Boolean);
}

export function matchesFeatures(product, features = {}) {
  const details = productDetails[product.id] ?? {};
  return (!features.wifi || (details.wifi >= features.wifi && (!features.wifi6e || details.wifiLabel === '6E')))
    && (!features.cellular || details.cellular === features.cellular)
    && (!features.storageGB || details.storageGB >= features.storageGB)
    && (!features.batteryHours || details.batteryHours >= features.batteryHours);
}
