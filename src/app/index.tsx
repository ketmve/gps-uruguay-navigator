import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Platform,
  StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import RADARES_JSON from '../data/radares.json';

// suncalc no trae tipos; se importa con require para evitar errores de TypeScript
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SunCalc = require('suncalc');

interface Radar {
  id: string;
  name: string;
  lat: number;
  lon: number;
  zone: string;
}

// Radares oficiales del MTOP (rutas nacionales), ver src/data/radares.json
const RADARES_URUGUAY: Radar[] = RADARES_JSON as Radar[];

function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Es de noche si la hora actual está antes del amanecer o después del atardecer
function computeIsNight(lat: number, lon: number): boolean {
  try {
    const now = new Date();
    const times = SunCalc.getTimes(now, lat, lon);
    return now < times.sunrise || now > times.sunset;
  } catch {
    const h = new Date().getHours();
    return h < 7 || h >= 20;
  }
}

const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #e5e7eb; }
    body.night, body.night #map { background: #000000; }

    /* Modo noche: se invierten los colores del mapa claro para obtener un mapa oscuro */
    body.night .leaflet-tile-pane {
      filter: invert(1) hue-rotate(180deg) brightness(0.8) contrast(0.95) saturate(0.6);
    }

    .leaflet-popup-content-wrapper, .leaflet-popup-tip {
      background: #000000;
      color: #ffffff;
      border: 1px solid #333333;
    }
    .leaflet-popup-close-button { color: #ffffff !important; }
    .leaflet-container a.leaflet-popup-close-button:hover { color: #cccccc !important; }
    .leaflet-control-attribution {
      background: rgba(0,0,0,0.7) !important;
      color: #cccccc !important;
    }
    .leaflet-control-attribution a { color: #ffffff !important; }

    .radar-badge {
      background: #dc2626;
      color: white;
      border: 2px solid white;
      border-radius: 50%;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 11px;
      font-family: sans-serif;
      box-shadow: 0 2px 4px rgba(0,0,0,0.4);
    }
    .user-dot {
      background: #2563eb;
      border: 3px solid white;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      box-shadow: 0 0 10px rgba(37,99,235,0.8);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map', { zoomControl: false }).setView([-34.9011, -56.1645], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    let userMarker = null;
    let destMarker = null;
    let routeLine = null;
    let followUser = true;

    map.on('dragstart', () => { followUser = false; });

    window.setNight = function(isNight) {
      document.body.classList.toggle('night', !!isNight);
    };

    window.initRadars = function(radars) {
      radars.forEach(r => {
        const icon = L.divIcon({
          className: '',
          html: '<div class="radar-badge">!</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
        L.marker([r.lat, r.lon], { icon })
          .addTo(map)
          .bindPopup('<b>Radar ' + r.zone + '</b><br>' + r.name);
      });
    };

    window.updateUserLocation = function(lat, lon) {
      if (!userMarker) {
        const icon = L.divIcon({
          className: '',
          html: '<div class="user-dot"></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });
        userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
        map.setView([lat, lon], 15);
      } else {
        userMarker.setLatLng([lat, lon]);
        if (followUser) {
          map.panTo([lat, lon]);
        }
      }
    };

    window.centerOnUser = function(lat, lon) {
      followUser = true;
      map.setView([lat, lon], 16);
    };

    window.drawRoute = function(coords, destLat, destLon, destLabel) {
      followUser = false;
      if (routeLine) map.removeLayer(routeLine);
      if (destMarker) map.removeLayer(destMarker);

      // Ruta negra con borde blanco: se ve igual de bien en el mapa claro y en el oscuro
      const casing = L.polyline(coords, {
        color: '#ffffff',
        weight: 10,
        opacity: 0.95
      });
      const line = L.polyline(coords, {
        color: '#000000',
        weight: 6,
        opacity: 1
      });
      routeLine = L.layerGroup([casing, line]).addTo(map);

      destMarker = L.marker([destLat, destLon])
        .addTo(map)
        .bindPopup('<b>Destino:</b><br>' + destLabel)
        .openPopup();

      map.fitBounds(line.getBounds(), { padding: [55, 55] });
    };

    window.clearRoute = function(lat, lon) {
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
      if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
      followUser = true;
      if (lat && lon) map.setView([lat, lon], 15);
    };
  </script>
</body>
</html>
`;

export default function GpsUruguayScreen() {
  const webViewRef = useRef<WebView>(null);
  const [location, setLocation] = useState<{ lat: number; lon: number }>({
    lat: -34.9011,
    lon: -56.1645,
  });
  const [speedKmh, setSpeedKmh] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadingRoute, setLoadingRoute] = useState<boolean>(false);
  const [routeInfo, setRouteInfo] = useState<{
    distanceKm: string;
    durationMin: number;
    destName: string;
  } | null>(null);
  const [activeRadar, setActiveRadar] = useState<Radar | null>(null);
  const [mapReady, setMapReady] = useState<boolean>(false);
  const [isNight, setIsNight] = useState<boolean>(() =>
    computeIsNight(-34.9011, -56.1645)
  );
  const lastAlertedId = useRef<string | null>(null);

  useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permiso de ubicación',
          'Activa el GPS para navegar en tiempo real y recibir alertas de radares en Uruguay.'
        );
        return;
      }

      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const initCoords = {
        lat: initial.coords.latitude,
        lon: initial.coords.longitude,
      };
      setLocation(initCoords);

      subscriber = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          const lat = loc.coords.latitude;
          const lon = loc.coords.longitude;
          const currentSpeed = loc.coords.speed ? Math.max(0, Math.round(loc.coords.speed * 3.6)) : 0;

          setLocation({ lat, lon });
          setSpeedKmh(currentSpeed);

          webViewRef.current?.injectJavaScript(
            `if (window.updateUserLocation) { window.updateUserLocation(${lat}, ${lon}); } true;`
          );

          checkNearbyRadars(lat, lon);
        }
      );
    })();

    return () => {
      if (subscriber) subscriber.remove();
    };
  }, []);

  // Cada minuto se revisa si ya amaneció o anocheció en la ubicación actual
  const roundedLat = Math.round(location.lat);
  const roundedLon = Math.round(location.lon);
  useEffect(() => {
    const update = () => setIsNight(computeIsNight(location.lat, location.lon));
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [roundedLat, roundedLon]);

  // Se avisa al mapa cada vez que cambia entre día y noche
  useEffect(() => {
    if (mapReady) {
      webViewRef.current?.injectJavaScript(
        `if (window.setNight) { window.setNight(${isNight}); } true;`
      );
    }
  }, [isNight, mapReady]);

  useEffect(() => {
    if (mapReady) {
      const radarsJson = JSON.stringify(RADARES_URUGUAY);
      webViewRef.current?.injectJavaScript(
        `if (window.initRadars) { window.initRadars(${radarsJson}); window.updateUserLocation(${location.lat}, ${location.lon}); } true;`
      );
    }
  }, [mapReady]);

  const checkNearbyRadars = (lat: number, lon: number) => {
    let closest: Radar | null = null;
    let minDist = Infinity;

    for (const r of RADARES_URUGUAY) {
      const d = getDistanceMeters(lat, lon, r.lat, r.lon);
      if (d <= 500 && d < minDist) {
        minDist = d;
        closest = r;
      }
    }

    setActiveRadar(closest);

    if (closest && lastAlertedId.current !== closest.id) {
      lastAlertedId.current = closest.id;
      Speech.speak(
        `Atención, radar de velocidad a ${Math.round(minDist)} metros.`,
        { language: 'es-UY', rate: 1.0 }
      );
    } else if (!closest) {
      lastAlertedId.current = null;
    }
  };

  const handleSearchAndRoute = async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setLoadingRoute(true);
    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=uy&limit=1&q=${encodeURIComponent(
        query
      )}`;
      const geoRes = await fetch(geoUrl, {
        headers: { 'User-Agent': 'GpsUruguayNavigator/1.0' },
      });
      const geoData = await geoRes.json();

      if (!geoData || geoData.length === 0) {
        Alert.alert('Destino no encontrado', 'Prueba con una calle, esquina o ciudad de Uruguay.');
        setLoadingRoute(false);
        return;
      }

      const destLat = parseFloat(geoData[0].lat);
      const destLon = parseFloat(geoData[0].lon);
      const destLabel = geoData[0].display_name.split(',').slice(0, 2).join(', ');

      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${location.lon},${location.lat};${destLon},${destLat}?overview=full&geometries=geojson`;
      const routeRes = await fetch(osrmUrl);
      const routeData = await routeRes.json();

      if (!routeData.routes || routeData.routes.length === 0) {
        Alert.alert('Ruta no disponible', 'No se pudo trazar una ruta por calles hasta ese destino.');
        setLoadingRoute(false);
        return;
      }

      const bestRoute = routeData.routes[0];
      const latLngCoords = bestRoute.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
      const distanceKm = (bestRoute.distance / 1000).toFixed(1);
      const durationMin = Math.max(1, Math.round(bestRoute.duration / 60));

      setRouteInfo({ distanceKm, durationMin, destName: destLabel });

      const coordsJson = JSON.stringify(latLngCoords);
      const safeLabel = JSON.stringify(destLabel);
      webViewRef.current?.injectJavaScript(
        `if (window.drawRoute) { window.drawRoute(${coordsJson}, ${destLat}, ${destLon}, ${safeLabel}); } true;`
      );

      Speech.speak(
        `Ruta calculada hacia ${destLabel}. Distancia ${distanceKm} kilómetros, tiempo estimado ${durationMin} minutos.`,
        { language: 'es-UY' }
      );
    } catch (err) {
      Alert.alert('Error de conexión', 'Verifica tu conexión a internet para calcular la ruta.');
    } finally {
      setLoadingRoute(false);
    }
  };

  const handleClearRoute = () => {
    setRouteInfo(null);
    setSearchQuery('');
    webViewRef.current?.injectJavaScript(
      `if (window.clearRoute) { window.clearRoute(${location.lat}, ${location.lon}); } true;`
    );
  };

  const handleRecenter = () => {
    webViewRef.current?.injectJavaScript(
      `if (window.centerOnUser) { window.centerOnUser(${location.lat}, ${location.lon}); } true;`
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Buscar calle, esquina o ciudad en Uruguay..."
          placeholderTextColor="#9ca3af"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearchAndRoute}
          returnKeyType="search"
          selectionColor="#ffffff"
        />
        <TouchableOpacity
          style={styles.searchBtn}
          onPress={handleSearchAndRoute}
          disabled={loadingRoute}
        >
          {loadingRoute ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.searchBtnText}>Ir</Text>
          )}
        </TouchableOpacity>
      </View>

      {activeRadar && (
        <View style={styles.radarBanner}>
          <View style={styles.radarSign}>
            <Text style={styles.radarSignText}>!</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.radarTitle}>RADAR PRÓXIMO ({activeRadar.zone})</Text>
            <Text style={styles.radarSub}>{activeRadar.name}</Text>
          </View>
        </View>
      )}

      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: LEAFLET_HTML, baseUrl: 'https://gps-uruguay-navigator.app' }}
        style={styles.map}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onLoadEnd={() => setMapReady(true)}
      />

      <TouchableOpacity style={styles.recenterBtn} onPress={handleRecenter}>
        <Text style={styles.recenterText}>📍 Centrar</Text>
      </TouchableOpacity>

      <View style={styles.speedBox}>
        <Text style={styles.speedValue}>{speedKmh}</Text>
        <Text style={styles.speedUnit}>km/h</Text>
      </View>

      {routeInfo && (
        <View style={styles.routePanel}>
          <View style={{ flex: 1 }}>
            <Text style={styles.routeDest} numberOfLines={1}>
              {routeInfo.destName}
            </Text>
            <Text style={styles.routeStats}>
              {routeInfo.durationMin} min • {routeInfo.distanceKm} km
            </Text>
          </View>
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearRoute}>
            <Text style={styles.clearBtnText}>Finalizar</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  searchBar: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#262626',
    zIndex: 10,
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#404040',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#ffffff',
  },
  searchBtn: {
    marginLeft: 8,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#404040',
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  radarBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderBottomWidth: 2,
    borderBottomColor: '#dc2626',
    padding: 10,
  },
  radarSign: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 4,
    borderColor: '#dc2626',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  radarSignText: {
    fontWeight: '900',
    fontSize: 16,
    color: '#000000',
  },
  radarTitle: {
    fontWeight: 'bold',
    fontSize: 13,
    color: '#ffffff',
  },
  radarSub: {
    fontSize: 13,
    color: '#d4d4d4',
  },
  map: {
    flex: 1,
    backgroundColor: '#000000',
  },
  recenterBtn: {
    position: 'absolute',
    right: 16,
    bottom: 120,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#404040',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 24,
    elevation: 4,
  },
  recenterText: {
    fontWeight: 'bold',
    color: '#ffffff',
    fontSize: 13,
  },
  speedBox: {
    position: 'absolute',
    left: 16,
    bottom: 115,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
    elevation: 5,
  },
  speedValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  speedUnit: {
    color: '#d4d4d4',
    fontSize: 11,
  },
  routePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#262626',
  },
  routeDest: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  routeStats: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
    marginTop: 2,
  },
  clearBtn: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#404040',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginLeft: 12,
  },
  clearBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
