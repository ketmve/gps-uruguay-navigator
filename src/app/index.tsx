import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  View, 
  TextInput, 
  StatusBar, 
  Text, 
  Vibration, 
  TouchableOpacity, 
  Modal, 
  FlatList, 
  SafeAreaView,
  Keyboard,
  ScrollView
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SunCalc from 'suncalc';
import * as Speech from 'expo-speech';
import * as Location from 'expo-location';

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error capturado:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.errorContainer}>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={styles.errorTitle}>⚠️ Error detectado:</Text>
            <Text style={styles.errorMessage}>{this.state.error?.toString()}</Text>
            <TouchableOpacity 
              style={styles.errorButton}
              onPress={() => this.setState({ hasError: false, error: null })}
            >
              <Text style={styles.errorButtonText}>Reiniciar App</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const radaresData = {
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.140442, -34.909668] }, "properties": { "id": "IM-01", "nombre": "Rambla Rep. del Perú y Basilio Pereyra", "limite_velocidad_kmh": 60, "heading_orientacion": 110, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.169008, -34.917674] }, "properties": { "id": "IM-02", "nombre": "Rambla Wilson y Dr. Juan A. Cachón", "limite_velocidad_kmh": 60, "heading_orientacion": 110, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.054413, -34.890908] }, "properties": { "id": "IM-03", "nombre": "Rambla Rep. de México y Costa Rica", "limite_velocidad_kmh": 60, "heading_orientacion": 90, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.154894, -34.924922] }, "properties": { "id": "IM-04", "nombre": "Rambla M. Gandhi y Solano García", "limite_velocidad_kmh": 60, "heading_orientacion": 110, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.104404, -34.896148] }, "properties": { "id": "IM-05", "nombre": "Rambla O'Higgins y 18 de Diciembre", "limite_velocidad_kmh": 60, "heading_orientacion": 90, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.082155, -34.887644] }, "properties": { "id": "IM-06", "nombre": "Rambla e Ibiza", "limite_velocidad_kmh": 60, "heading_orientacion": 90, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.114457, -34.887159] }, "properties": { "id": "IM-07", "nombre": "Av. Italia y Caldas", "limite_velocidad_kmh": 60, "heading_orientacion": 90, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.121302, -34.887040] }, "properties": { "id": "IM-08", "nombre": "Av. Italia y Mataojo", "limite_velocidad_kmh": 60, "heading_orientacion": 90, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.138865, -34.874085] }, "properties": { "id": "IM-09", "nombre": "Av. 8 de Octubre y Larravide", "limite_velocidad_kmh": 45, "heading_orientacion": 270, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.149200, -34.883500] }, "properties": { "id": "IM-10", "nombre": "Av. 8 de Octubre y Pan de Azúcar", "limite_velocidad_kmh": 45, "heading_orientacion": 90, "tolerancia_grados": 30 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.221500, -34.851200] }, "properties": { "id": "MTOP-R5-01", "nombre": "Ruta 5 km 12 (Accesos a Montevideo)", "limite_velocidad_kmh": 75, "heading_orientacion": 0, "tolerancia_grados": 45 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.321000, -34.781200] }, "properties": { "id": "MTOP-R5-02", "nombre": "Ruta 5 km 25 (Las Piedras / La Paz)", "limite_velocidad_kmh": 60, "heading_orientacion": 180, "tolerancia_grados": 45 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-55.912000, -34.810000] }, "properties": { "id": "MTOP-RIB-01", "nombre": "Ruta Interbalnearia km 24 (El Pinar)", "limite_velocidad_kmh": 75, "heading_orientacion": 90, "tolerancia_grados": 45 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.350000, -34.750000] }, "properties": { "id": "MTOP-R1-01", "nombre": "Ruta 1 km 20 (Cruce Cno. Melilla)", "limite_velocidad_kmh": 75, "heading_orientacion": 270, "tolerancia_grados": 45 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.012500, -34.821000] }, "properties": { "id": "MTOP-R8-01", "nombre": "Ruta 8 km 22 (Barros Blancos)", "limite_velocidad_kmh": 60, "heading_orientacion": 45, "tolerancia_grados": 45 } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [-56.281200, -34.831500] }, "properties": { "id": "MTOP-R102-01", "nombre": "Ruta 102 km 18 (Anillo Perimetral)", "limite_velocidad_kmh": 80, "heading_orientacion": 90, "tolerancia_grados": 45 } }
  ]
};

const getDistanceFromLatLonInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

function MainNavigatorApp() {
  const mapRef = useRef(null);
  const inputRef = useRef(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeAlert, setActiveAlert] = useState(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  
  const [is3DMode, setIs3DMode] = useState(true);
  const [currentStreet, setCurrentStreet] = useState("Ubicando calle...");
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [userHeading, setUserHeading] = useState(0);

  const [navState, setNavState] = useState('IDLE');
  const [destination, setDestination] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  
  const [modalVisible, setModalVisible] = useState(false);
  const [newFavName, setNewFavName] = useState('');
  
  const [location, setLocation] = useState({
    latitude: -34.9011,
    longitude: -56.1645,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  });

  useEffect(() => {
    let subscriber = null;

    const startLocationTracking = async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setCurrentStreet("Permiso de ubicación denegado");
          return;
        }
        setPermissionGranted(true);

        subscriber = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 2000,
            distanceInterval: 5,
          },
          async (loc) => {
            const { latitude, longitude, heading, speed } = loc.coords;
            
            if (navState !== 'NAVIGATING' && navState !== 'PREVIEW') {
              setLocation({
                latitude,
                longitude,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
              });
            }

            if (heading !== null && heading !== undefined) {
              setUserHeading(heading);
            }

            const speedKmh = speed && speed > 0 ? Math.round(speed * 3.6) : 0;
            setCurrentSpeed(speedKmh);

            checkRadarsProximity(latitude, longitude, heading || 0, speedKmh);

            try {
              const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
              if (reverse && reverse.length > 0) {
                const streetName = reverse[0].street || reverse[0].name;
                if (streetName) {
                  setCurrentStreet(streetName);
                }
              }
            } catch (e) {}

            if (navState === 'NAVIGATING' && destination) {
              const distToDest = getDistanceFromLatLonInMeters(latitude, longitude, destination.latitude, destination.longitude);
              
              if (distToDest < 20) {
                speakMessage("Ha llegado a su destino. Finalizando recorrido.");
                setNavState('IDLE');
                setDestination(null);
                setRouteCoordinates([]);
                return;
              }

              checkOffRoute(latitude, longitude);
            }
          }
        );
      } catch (e) {
        console.error("Error en localización:", e);
      }
    };

    startLocationTracking();

    return () => {
      if (subscriber) subscriber.remove();
    };
  }, [navState, destination, routeCoordinates]);

  useEffect(() => {
    const updateThemeBySun = () => {
      try {
        const sunCalcLib = SunCalc.default || SunCalc;
        if (sunCalcLib && sunCalcLib.getTimes) {
          const times = sunCalcLib.getTimes(new Date(), location.latitude, location.longitude);
          const now = new Date();
          const night = now > times.sunset || now < times.sunrise;
          setIsDarkMode(night);
        }
      } catch (e) {}
    };

    updateThemeBySun();
    const interval = setInterval(updateThemeBySun, 60000);
    return () => clearInterval(interval);
  }, [location]);

  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const savedFavorites = await AsyncStorage.getItem('@user_favorites');
        if (savedFavorites) setFavorites(JSON.parse(savedFavorites));
      } catch (e) {}
    };
    loadFavorites();
  }, []);

  const speakMessage = (message) => {
    try {
      Speech.isSpeakingAsync().then((speaking) => {
        if (speaking) Speech.stop();
        Speech.speak(message, { language: 'es-ES', pitch: 1.0, rate: 1.0 });
      });
    } catch (e) {}
  };

  const checkRadarsProximity = (userLat, userLng, userHeading, speedKmh) => {
    let alertFound = null;
    radaresData.features.forEach((radar) => {
      const [radarLng, radarLat] = radar.geometry.coordinates;
      const distance = getDistanceFromLatLonInMeters(userLat, userLng, radarLat, radarLng);
      if (distance <= 500) {
        const radarHeading = radar.properties.heading_orientacion;
        const tolerance = radar.properties.tolerancia_grados || 30;
        let angleDiff = Math.abs(userHeading - radarHeading);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;
        if (angleDiff <= tolerance) {
          alertFound = {
            name: radar.properties.nombre,
            limit: radar.properties.limite_velocidad_kmh,
            distance: Math.round(distance),
            isSpeeding: speedKmh > radar.properties.limite_velocidad_kmh,
          };
        }
      }
    });

    if (alertFound && (!activeAlert || activeAlert.name !== alertFound.name)) {
      setActiveAlert(alertFound);
      Vibration.vibrate(200);
      const warningText = alertFound.isSpeeding 
        ? `¡Atención! Reduzca velocidad. Radar a ${alertFound.distance} metros. Límite, ${alertFound.limit} kilómetros por hora.`
        : `Atención. Radar a ${alertFound.distance} metros. Límite, ${alertFound.limit} kilómetros por hora.`;
      speakMessage(warningText);
    } else if (!alertFound) {
      setActiveAlert(null);
    }
  };

  const checkOffRoute = (userLat, userLng) => {
    let minDistance = 999999;
    routeCoordinates.forEach(coord => {
      const d = getDistanceFromLatLonInMeters(userLat, userLng, coord.latitude, coord.longitude);
      if (d < minDistance) minDistance = d;
    });

    if (minDistance > 50) {
      setNavState('REROUTING');
      speakMessage("Recalculando ruta...");
      setTimeout(() => {
        const newRoute = [
          { latitude: userLat, longitude: userLng },
          { latitude: destination.latitude, longitude: destination.longitude }
        ];
        setRouteCoordinates(newRoute);
        setNavState('NAVIGATING');
        if (mapRef.current) {
          mapRef.current.fitToCoordinates(newRoute, {
            edgePadding: { top: 100, right: 80, bottom: 250, left: 80 },
            animated: true,
          });
        }
      }, 2000);
    }
  };

  const handleSearchSubmit = async (queryToSearch) => {
    const query = queryToSearch || searchQuery;
    if (!query.trim()) return;
    Keyboard.dismiss();
    try {
      speakMessage("Buscando dirección...");
      const geocoded = await Location.geocodeAsync(query + ", Montevideo, Uruguay");
      
      if (geocoded && geocoded.length > 0) {
        const { latitude, longitude } = geocoded[0];
        const dest = {
          name: query,
          latitude,
          longitude,
        };
        setDestination(dest);

        const newRoute = [
          { latitude: location.latitude, longitude: location.longitude },
          { latitude, longitude }
        ];
        setRouteCoordinates(newRoute);
        setNavState('PREVIEW');
        speakMessage(`Destino encontrado: ${query}`);

        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.fitToCoordinates(newRoute, {
              edgePadding: { top: 120, right: 80, bottom: 260, left: 80 },
              animated: true,
            });
          }
        }, 300);

      } else {
        speakMessage("No se encontró la dirección ingresada.");
      }
    } catch (error) {
      speakMessage("Error al buscar la dirección.");
    }
  };

  const handleStartNavigation = () => {
    setNavState('NAVIGATING');
    speakMessage(`Iniciando recorrido hacia ${destination.name}. Conduzca con precaución.`);
  };

  const handleVoiceDictation = () => {
    speakMessage("Toque el micrófono en su teclado para dictar la dirección.");
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleSaveFavorite = async () => {
    if (!newFavName.trim()) return;
    const newFav = { id: Date.now().toString(), name: newFavName, lat: location.latitude, lng: location.longitude };
    const updated = [...favorites, newFav];
    setFavorites(updated);
    try { await AsyncStorage.setItem('@user_favorites', JSON.stringify(updated)); } catch (e) {}
    setNewFavName('');
    setModalVisible(false);
  };

  const distToDest = destination ? getDistanceFromLatLonInMeters(location.latitude, location.longitude, destination.latitude, destination.longitude) : 99999;
  const isApproaching = distToDest < 50;
  const activePitch = (navState === 'NAVIGATING' && is3DMode && !isApproaching) ? 60 : 0;
  const activeZoom = (navState === 'NAVIGATING' && is3DMode && !isApproaching) ? 17 : (isApproaching ? 15 : 13);
  const activeAltitude = (navState === 'NAVIGATING' && is3DMode && !isApproaching) ? 1000 : 3000;

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#000000' : '#F6F6F6' }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={isDarkMode ? '#000000' : '#FFFFFF'} />
      
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={location}
        userInterfaceStyle={isDarkMode ? 'dark' : 'light'}
        showsUserLocation={permissionGranted && (currentSpeed > 0 || navState === 'NAVIGATING')}
        showsMyLocationButton={false}
        showsCompass={true}
        pitchEnabled={true}
        rotateEnabled={true}
        camera={navState === 'NAVIGATING' || navState === 'PREVIEW' ? {
          center: { latitude: location.latitude, longitude: location.longitude },
          pitch: activePitch,
          heading: userHeading,
          altitude: activeAltitude,
          zoom: activeZoom,
        } : undefined}
      >
        {routeCoordinates.length > 0 && (
          <Polyline coordinates={routeCoordinates} strokeWidth={6} strokeColor="#000000" />
        )}

        {currentSpeed === 0 && navState !== 'NAVIGATING' && (
          <Marker coordinate={{ latitude: location.latitude, longitude: location.longitude }} title="Mi Vehículo" anchor={{ x: 0.5, y: 0.5 }} rotation={userHeading}>
            <View style={styles.carBadge}>
              <Text style={{ fontSize: 24 }}>🚗</Text>
            </View>
          </Marker>
        )}

        {destination && (
          <Marker coordinate={{ latitude: destination.latitude, longitude: destination.longitude }} title={destination.name} pinColor="#276EF1" />
        )}

        {radaresData.features.map((radar) => {
          const [lng, lat] = radar.geometry.coordinates;
          return (
            <Marker key={radar.properties.id} coordinate={{ latitude: lat, longitude: lng }} title={`⚠️ ${radar.properties.nombre}`}>
              <View style={styles.radarBadge}>
                <Text style={{ fontSize: 18 }}>🚨</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {navState === 'IDLE' && (
        <View style={[styles.searchCard, { backgroundColor: isDarkMode ? '#000000' : '#FFFFFF', borderColor: isDarkMode ? '#222222' : '#E2E2E2' }]}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: isDarkMode ? '#FFFFFF' : '#111111' }]}
            placeholder="¿A dónde vamos? (Ej. Av. Italia 2500)"
            placeholderTextColor={isDarkMode ? '#888888' : '#666666'}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => handleSearchSubmit()}
          />
          <TouchableOpacity style={styles.micButton} onPress={handleVoiceDictation}>
            <Text style={{ fontSize: 18 }}>🎤</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlButton, { backgroundColor: isDarkMode ? '#222222' : '#F0F0F0' }]} onPress={() => setModalVisible(true)}>
            <Text style={{ color: isDarkMode ? '#FFFFFF' : '#111111', fontWeight: 'bold' }}>⭐</Text>
          </TouchableOpacity>
        </View>
      )}

      {navState === 'PREVIEW' && destination && (
        <View style={[styles.previewCard, { backgroundColor: isDarkMode ? '#111111' : '#FFFFFF' }]}>
          <Text style={[styles.previewTitle, { color: isDarkMode ? '#FFFFFF' : '#111111' }]}>Destino: {destination.name}</Text>
          <Text style={{ color: '#888888', marginBottom: 15 }}>Ruta lista • Vista general de origen y llegada</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <TouchableOpacity style={styles.cancelPreviewBtn} onPress={() => { setNavState('IDLE'); setDestination(null); setRouteCoordinates([]); }}>
              <Text style={{ color: '#FF3B30', fontWeight: 'bold' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.startNavBtn} onPress={handleStartNavigation}>
              <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>Iniciar Recorrido</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {navState === 'REROUTING' && (
        <View style={styles.reroutingBanner}>
          <Text style={styles.reroutingText}>🔄 Desvío detectado: Recalculando ruta...</Text>
        </View>
      )}

      {navState === 'NAVIGATING' && (
        <>
          <View style={styles.navTopCard}>
            <View style={styles.navTopRow}>
              <Text style={styles.navArrow}>↱</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.navDistText}>{isApproaching ? 'Llegando al destino' : 'Continuar ruta'}</Text>
                <Text style={styles.navStreetTitle} numberOfLines={1}>
                  {destination ? `Hacia ${destination.name}` : currentStreet}
                </Text>
              </View>
              <TouchableOpacity style={styles.toolsButton} onPress={() => setModalVisible(true)}>
                <Text style={styles.toolsIcon}>⚙️</Text>
                <Text style={styles.toolsText}>Tools</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.speedLimitBadge}>
            <Text style={styles.speedLimitNum}>60</Text>
            <Text style={styles.speedLimitLabel}>LÍMITE</Text>
          </View>

          <View style={styles.currentStreetBadge}>
            <Text style={styles.currentStreetBadgeText}>{currentStreet}</Text>
          </View>
        </>
      )}

      {activeAlert && (
        <View style={[styles.alertBanner, { backgroundColor: activeAlert.isSpeeding ? '#D32F2F' : '#FF3B30' }]}>
          <Text style={styles.alertText}>
            {activeAlert.isSpeeding ? '🚨 ¡BAJE LA VELOCIDAD! ' : '🚨 '} 
            {activeAlert.name} ({activeAlert.distance}m) - Máx: {activeAlert.limit} km/h
          </Text>
        </View>
      )}

      <View style={[styles.bottomStreetCard, { backgroundColor: isDarkMode ? '#000000' : '#FFFFFF', borderColor: isDarkMode ? '#222222' : '#E2E2E2' }]}>
        <View style={styles.speedometerContainer}>
          <Text style={[styles.speedText, { color: activeAlert && activeAlert.isSpeeding ? '#FF3B30' : (isDarkMode ? '#FFFFFF' : '#111111') }]}>
            {currentSpeed}
          </Text>
          <Text style={{ color: '#888888', fontSize: 10, fontWeight: 'bold' }}>KM/H</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tripInfoTitle, { color: isDarkMode ? '#FFFFFF' : '#111111' }]}>
            {destination ? destination.name : 'Navegación libre'}
          </Text>
          <Text style={{ color: '#888888', fontSize: 13, fontWeight: '600' }}>
            Circulando por: {currentStreet}
          </Text>
        </View>
        {navState === 'NAVIGATING' && (
          <TouchableOpacity onPress={() => { setNavState('IDLE'); setDestination(null); setRouteCoordinates([]); }}>
            <Text style={{ color: '#FF3B30', fontWeight: 'bold' }}>Salir</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal animationType="slide" transparent={true} visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.95)' : 'rgba(255,255,255,0.95)' }]}>
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: isDarkMode ? '#FFFFFF' : '#111111' }]}>Panel de Administración y Favoritos</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: isDarkMode ? '#1A1A1A' : '#F0F0F0', color: isDarkMode ? '#FFFFFF' : '#111111', borderColor: isDarkMode ? '#333333' : '#CCCCCC' }]}
              placeholder="Nombre del lugar favorito (ej. Casa)"
              placeholderTextColor={isDarkMode ? '#888888' : '#666666'}
              value={newFavName}
              onChangeText={setNewFavName}
            />
            <TouchableOpacity style={styles.saveButton} onPress={handleSaveFavorite}>
              <Text style={styles.saveButtonText}>Guardar Ubicación Actual</Text>
            </TouchableOpacity>
            <Text style={[styles.sectionTitle, { color: isDarkMode ? '#FFFFFF' : '#111111' }]}>Favoritos Guardados ({favorites.length})</Text>
            <FlatList
              data={favorites}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={[styles.favItem, { borderBottomColor: isDarkMode ? '#222222' : '#E2E2E2' }]}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => { 
                    setDestination(item); 
                    setNavState('PREVIEW'); 
                    setModalVisible(false);
                    const favRoute = [{ latitude: location.latitude, longitude: location.longitude }, { latitude: item.lat, longitude: item.lng }];
                    setRouteCoordinates(favRoute);
                    setTimeout(() => {
                      if (mapRef.current) {
                        mapRef.current.fitToCoordinates(favRoute, { edgePadding: { top: 120, right: 80, bottom: 260, left: 80 }, animated: true });
                      }
                    }, 300);
                  }}>
                    <Text style={[styles.favText, { color: isDarkMode ? '#FFFFFF' : '#111111' }]}>{item.name}</Text>
                    <Text style={{ color: '#888888', fontSize: 12 }}>{item.lat.toFixed(4)}, {item.lng.toFixed(4)}</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
            <TouchableOpacity style={[styles.closeButton, { backgroundColor: isDarkMode ? '#333333' : '#DDDDDD' }]} onPress={() => setModalVisible(false)}>
              <Text style={{ color: isDarkMode ? '#FFFFFF' : '#111111', fontWeight: 'bold' }}>Cerrar Panel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainNavigatorApp />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  carBadge: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 4, elevation: 5 },
  radarBadge: { backgroundColor: '#FFF0F0', borderRadius: 15, padding: 3, borderWidth: 1, borderColor: '#FF3B30' },
  searchCard: {
    position: 'absolute', top: 55, left: 20, right: 20, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', elevation: 6
  },
  input: { flex: 1, fontSize: 16, fontWeight: '600' },
  micButton: { padding: 8, marginRight: 5 },
  controlButton: { marginLeft: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  previewCard: {
    position: 'absolute', top: 55, left: 20, right: 20, borderRadius: 12, padding: 16, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8
  },
  previewTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
  startNavBtn: { backgroundColor: '#276EF1', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  cancelPreviewBtn: { paddingVertical: 10, paddingHorizontal: 20, justifyContent: 'center' },
  reroutingBanner: {
    position: 'absolute', top: 130, alignSelf: 'center', backgroundColor: '#FF9500', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, elevation: 6
  },
  reroutingText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 },
  navTopCard: {
    position: 'absolute', top: 45, left: 20, right: 20, backgroundColor: '#000000', borderRadius: 14, padding: 16, elevation: 8
  },
  navTopRow: { flexDirection: 'row', alignItems: 'center' },
  navArrow: { color: '#FFFFFF', fontSize: 36, fontWeight: 'bold', marginRight: 15 },
  navDistText: { color: '#AAAAAA', fontSize: 14, fontWeight: '600' },
  navStreetTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold' },
  toolsButton: { backgroundColor: '#222222', borderRadius: 24, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  toolsIcon: { fontSize: 16 },
  toolsText: { color: '#AAAAAA', fontSize: 10, fontWeight: 'bold', marginTop: 2 },
  speedLimitBadge: {
    position: 'absolute', top: 180, left: 20, backgroundColor: '#FFFFFF', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', elevation: 6
  },
  speedLimitNum: { fontSize: 22, fontWeight: 'bold', color: '#111111' },
  speedLimitLabel: { fontSize: 9, fontWeight: 'bold', color: '#666666' },
  currentStreetBadge: {
    position: 'absolute', bottom: 140, alignSelf: 'center', backgroundColor: '#111111', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8, elevation: 4
  },
  currentStreetBadgeText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  alertBanner: {
    position: 'absolute', top: 130, left: 20, right: 20, padding: 12, borderRadius: 8, alignItems: 'center', elevation: 4
  },
  alertText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  bottomStreetCard: {
    position: 'absolute', bottom: 35, left: 20, right: 20, borderRadius: 12, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', elevation: 6
  },
  speedometerContainer: {
    alignItems: 'center', justifyContent: 'center', marginRight: 15, paddingRight: 15, borderRightWidth: 1, borderRightColor: '#444'
  },
  speedText: { fontSize: 24, fontWeight: 'bold' },
  tripInfoTitle: { fontSize: 16, fontWeight: 'bold' },
  modalContainer: { flex: 1, justifyContent: 'flex-end' },
  modalContent: { height: '70%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, elevation: 10 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  modalInput: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 10 },
  saveButton: { backgroundColor: '#276EF1', padding: 14, borderRadius: 8, alignItems: 'center', marginBottom: 20 },
  saveButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  favItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  favText: { fontSize: 16, fontWeight: '600' },
  closeButton: { marginTop: 15, padding: 14, borderRadius: 8, alignItems: 'center' },
  errorContainer: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
  errorTitle: { color: '#FF3B30', fontSize: 20, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  errorMessage: { color: '#FFFFFF', fontSize: 14, marginBottom: 25, textAlign: 'center', paddingHorizontal: 20 },
  errorButton: { backgroundColor: '#276EF1', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 8 },
  errorButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 }
});
