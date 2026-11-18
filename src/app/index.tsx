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
  Linking,
  Modal,
  ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

interface NavStep {
  distance: number;
  name: string;
  maneuver: { type: string; modifier?: string; location: [number, number] };
}

interface NavState {
  steps: NavStep[];
  idx: number;
  said: number;
  destLat: number;
  destLon: number;
  destLabel: string;
  coords: number[][];
  totalDist: number;
  totalMin: number;
  offCount: number;
  lastRecalc: number;
}

type VoiceMode = 'full' | 'alerts' | 'off';

interface Fav {
  id: string;
  type: 'radar' | 'poi';
  lat: number;
  lon: number;
  name: string;
  note: string;
  icon: string;
  color: string;
  speed: string;
}
const FAV_ICONS = ['🏠', '🏢', '⛽', '🍽️', '🅿️', '🏥', '🛒', '⭐', '📍', '🚧'];
const FAV_COLORS = ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#9333ea'];

// Distancia en metros desde un punto hasta la línea de la ruta
function distToRouteMeters(lat: number, lon: number, coords: number[][]): number {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][1] - lon) * kx;
    const ay = (coords[i][0] - lat) * ky;
    const bx = (coords[i + 1][1] - lon) * kx;
    const by = (coords[i + 1][0] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best) best = d;
  }
  return best;
}

function fmtClock(minFromNow: number): string {
  const d = new Date(Date.now() + minFromNow * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface ExternalDest {
  lat?: number;
  lon?: number;
  label?: string;
  query?: string;
}

// Lee los enlaces que mandan otras apps (por ejemplo el botón Navegar de Cabify Driver)
function parseNavUrl(url: string): ExternalDest | null {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {}
  if (!/^(geo:|google\.navigation:)/i.test(decoded)) return null;

  const label = decoded.match(/\(([^)]+)\)\s*$/)?.[1];
  const pair = decoded.match(/(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (pair) {
    return { lat: parseFloat(pair[1]), lon: parseFloat(pair[2]), label };
  }
  const q = decoded.match(/[?&:]q=([^&]+)/i)?.[1];
  if (q) return { query: q.replace(/\+/g, ' ') };
  return null;
}

function fmtDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

// Convierte una maniobra de OSRM en una instrucción en español
function stepInstruction(step: NavStep): { arrow: string; text: string } {
  const { type, modifier } = step.maneuver;
  const street = step.name ? ` por ${step.name}` : '';
  const dirs: Record<string, string> = {
    left: 'a la izquierda',
    right: 'a la derecha',
    'slight left': 'ligeramente a la izquierda',
    'slight right': 'ligeramente a la derecha',
    'sharp left': 'cerrado a la izquierda',
    'sharp right': 'cerrado a la derecha',
    straight: 'recto',
    uturn: 'en U',
  };
  const arrows: Record<string, string> = {
    left: '←',
    right: '→',
    'slight left': '↖',
    'slight right': '↗',
    'sharp left': '↰',
    'sharp right': '↱',
    straight: '↑',
    uturn: '↶',
  };
  const arrow = (modifier && arrows[modifier]) || '↑';
  const dir = modifier ? dirs[modifier] : undefined;

  if (type === 'arrive') return { arrow: '⚑', text: 'Llegas a tu destino' };
  if (type === 'depart') return { arrow: '↑', text: `Sigue recto${street}` };
  if (type === 'roundabout' || type === 'rotary') {
    return { arrow: '↻', text: `Entra a la rotonda y toma la salida${street}` };
  }
  if (type === 'merge') return { arrow, text: `Incorpórate${street}` };
  if (type === 'fork') return { arrow, text: `Mantente ${dir || 'en el carril'}${street}` };
  if (!modifier || modifier === 'straight') return { arrow: '↑', text: `Sigue recto${street}` };
  return { arrow, text: `Gira ${dir}${street}` };
}

const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #e5e7eb; overflow: hidden; }
    body.night, body.night #map { background: #000000; }
    /* Modo noche: se invierten los colores del mapa para obtener un mapa oscuro */
    body.night .maplibregl-canvas { filter: invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.95) saturate(0.6); }
    .maplibregl-ctrl-attrib { background: rgba(0,0,0,0.7) !important; color: #cccccc !important; }
    .maplibregl-ctrl-attrib a { color: #ffffff !important; }
    .maplibregl-popup-content { background: #000; color: #fff; font: 13px sans-serif; border: 1px solid #333; }
    .maplibregl-popup-tip { display: none; }
    .radar-badge { background: #dc2626; color: #fff; border: 2px solid #fff; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font: bold 11px sans-serif; box-shadow: 0 2px 4px rgba(0,0,0,0.4); }
    .fav { width: 34px; height: 34px; box-sizing: border-box; border-radius: 50%; border: 2px solid #fff; color: #fff; display: flex; align-items: center; justify-content: center; font: bold 15px sans-serif; box-shadow: 0 2px 5px rgba(0,0,0,0.5); }
    .user-arrow { box-sizing: border-box; width: 40px; height: 40px; border-radius: 50%; background: #ffffff; color: #000000; border: 3px solid #000000; box-shadow: 0 0 8px rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }
    .user-arrow svg { width: 24px; height: 24px; }
    body.night .user-arrow { background: #000000; color: #ffffff; border-color: #ffffff; box-shadow: 0 0 8px rgba(255,255,255,0.35); }
    .dest-wrap { position: relative; width: 0; height: 0; }
    .dest-circle { position: absolute; left: -23px; top: -23px; width: 46px; height: 46px; box-sizing: border-box; border-radius: 50%; background: #000; border: 3px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
    .dest-circle svg { width: 22px; height: 22px; }
    .dest-label { position: absolute; left: 0; top: 30px; transform: translateX(-50%); white-space: nowrap; background: #fff; color: #000; font: bold 13px sans-serif; padding: 4px 10px; border-radius: 12px; border: 1px solid #000; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
    .bubble { position: relative; background: #fff; color: #000; font: bold 13px sans-serif; padding: 5px 12px; border-radius: 14px; border: 1px solid #000; box-shadow: 0 2px 6px rgba(0,0,0,0.4); white-space: nowrap; }
    .bubble.r::before { content: ''; position: absolute; left: -7px; top: 50%; margin-top: -6px; border: 6px solid transparent; border-left: 0; border-right-color: #000; }
    .bubble.l::before { content: ''; position: absolute; right: -7px; top: 50%; margin-top: -6px; border: 6px solid transparent; border-right: 0; border-left-color: #000; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    function post(o) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }

    const map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [-56.1645, -34.9011],
      zoom: 13,
      pitchWithRotate: false,
      maxPitch: 70,
      attributionControl: false
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    let ready = false, queue = [];
    function whenReady(fn) { if (ready) fn(); else queue.push(fn); }

    let userMarker = null, destMarker = null, favMarkers = [], bubbleMarkers = [];
    let routeCoords = null;   // [[lat, lon], ...]
    let followUser = true, overviewOn = false, placeMode = false;
    let pitch = 0, bearing = 0, lastBubbles = 0;

    function paintRoute() {
      if (!ready) return;
      const night = document.body.classList.contains('night');
      map.setPaintProperty('route-casing', 'line-color', night ? '#000000' : '#ffffff');
      map.setPaintProperty('route-line', 'line-color', night ? '#ffffff' : '#000000');
      map.getSource('route').setData({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: routeCoords ? routeCoords.map(c => [c[1], c[0]]) : [] }
      });
    }

    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 12 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000000', 'line-width': 7 } });
      ready = true;
      queue.forEach(f => f());
      queue = [];
      paintRoute();
    });

    map.on('dragstart', () => { followUser = false; });
    map.on('click', e => { if (placeMode) post({ type: 'place', lat: e.lngLat.lat, lon: e.lngLat.lng }); });

    window.setNight = function(isNight) {
      document.body.classList.toggle('night', !!isNight);
      paintRoute();
    };
    window.setPlaceMode = function(on) { placeMode = !!on; };

    window.initRadars = function(radars) {
      radars.forEach(r => {
        const el = document.createElement('div');
        el.className = 'radar-badge';
        el.textContent = '!';
        const popup = new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML('<b>Radar ' + r.zone + '</b><br>' + r.name);
        new maplibregl.Marker({ element: el }).setLngLat([r.lon, r.lat]).setPopup(popup).addTo(map);
      });
    };

    window.setFavorites = function(list) {
      favMarkers.forEach(m => m.remove());
      favMarkers = [];
      list.forEach(f => {
        const el = document.createElement('div');
        el.className = 'fav';
        el.style.background = f.color;
        el.textContent = f.type === 'radar' ? (f.speed || '!') : f.icon;
        el.onclick = function(ev) { ev.stopPropagation(); post({ type: 'fav', id: f.id }); };
        favMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([f.lon, f.lat]).addTo(map));
      });
    };

    // ---------- vehículo ----------
    function followCamera(lat, lon, heading, speed) {
      if (!followUser) return;
      const moving = speed > 5;
      // Poco a poco: detenido = 2D, en movimiento = 3D inmersivo
      if (moving) {
        pitch = Math.min(60, pitch + 10);
        if (heading >= 0) bearing = heading;
      } else if (speed < 2 && !routeCoords) {
        // sin ruta activa y detenido: vuelve al 2D; con ruta activa se queda en 3D
        pitch = Math.max(0, pitch - 10);
        if (pitch === 0) bearing = 0;
      }
      map.easeTo({
        center: [lon, lat],
        zoom: pitch > 0 ? 17 : 16,
        pitch: pitch,
        bearing: bearing,
        padding: { top: pitch > 0 ? 260 : 0, bottom: 0, left: 0, right: 0 },
        duration: 1000,
        easing: t => t
      });
    }

    window.updateUserLocation = function(lat, lon, heading, speed) {
      if (!userMarker) {
        const el = document.createElement('div');
        el.className = 'user-arrow';
        el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="currentColor"/></svg>';
        userMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([lon, lat]).addTo(map);
        map.jumpTo({ center: [lon, lat], zoom: 15 });
      } else {
        userMarker.setLngLat([lon, lat]);
      }
      if (typeof heading === 'number' && heading >= 0) userMarker.setRotation(heading);
      if (typeof speed === 'number') {
        followCamera(lat, lon, typeof heading === 'number' ? heading : -1, speed);
        if (routeCoords && pitch > 0 && Date.now() - lastBubbles > 1500) { lastBubbles = Date.now(); updateBubbles(); }
      }
    };

    window.centerOnUser = function(lat, lon) {
      overviewOn = false;
      followUser = true;
      map.easeTo({ center: [lon, lat], zoom: 16, duration: 600 });
    };
    // Rumbo de la ruta unos metros por delante de tu posición
    function routeBearing(lat, lon) {
      if (!routeCoords || routeCoords.length < 2) return bearing;
      let i0 = 0, best = Infinity;
      for (let i = 0; i < routeCoords.length; i++) {
        const d = dist([lon, lat], [routeCoords[i][1], routeCoords[i][0]]);
        if (d < best) { best = d; i0 = i; }
      }
      let j = i0, acc = 0;
      while (j < routeCoords.length - 1 && acc < 40) {
        acc += dist([routeCoords[j][1], routeCoords[j][0]], [routeCoords[j + 1][1], routeCoords[j + 1][0]]);
        j++;
      }
      if (j === i0) return bearing;
      const dx = (routeCoords[j][1] - routeCoords[i0][1]) * Math.cos(lat * Math.PI / 180);
      const dy = routeCoords[j][0] - routeCoords[i0][0];
      return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    }

    // Al iniciar la ruta se entra directo al modo 3D, mirando hacia donde va la ruta
    window.startNav = function(lat, lon) {
      overviewOn = false;
      followUser = true;
      if (routeCoords && routeCoords.length > 1) {
        pitch = 60;
        bearing = routeBearing(lat, lon);
      }
      map.easeTo({
        center: [lon, lat],
        zoom: pitch > 0 ? 17 : 16,
        pitch: pitch,
        bearing: bearing,
        padding: { top: pitch > 0 ? 260 : 0, bottom: 0, left: 0, right: 0 },
        duration: 1500
      });
    };

    function fitRoute() {
      if (!routeCoords || !routeCoords.length) return;
      const b = new maplibregl.LngLatBounds();
      routeCoords.forEach(c => b.extend([c[1], c[0]]));
      pitch = 0; bearing = 0;
      map.fitBounds(b, { padding: { top: 90, bottom: 90, left: 50, right: 50 }, pitch: 0, bearing: 0, duration: 900 });
    }
    window.toggleOverview = function(lat, lon) {
      if (overviewOn || !routeCoords) {
        window.startNav(lat, lon);
      } else {
        overviewOn = true;
        followUser = false;
        fitRoute();
      }
    };

    window.drawRoute = function(coords, destLat, destLon, destLabel, fit) {
      routeCoords = coords;
      whenReady(paintRoute);
      if (destMarker) destMarker.remove();
      const safe = String(destLabel).replace(/[<>&"]/g, '');
      const pin = '<svg viewBox="0 0 24 24"><path fill="#ffffff" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.500a2.5 2.5 0 0 1 0 5z"/></svg>';
      const el = document.createElement('div');
      el.className = 'dest-wrap';
      el.innerHTML = '<div class="dest-circle">' + pin + '</div><div class="dest-label">' + safe + '</div>';
      destMarker = new maplibregl.Marker({ element: el }).setLngLat([destLon, destLat]).addTo(map);
      if (fit) { followUser = false; overviewOn = true; fitRoute(); }
    };

    window.clearRoute = function(lat, lon) {
      routeCoords = null;
      overviewOn = false;
      whenReady(paintRoute);
      if (destMarker) { destMarker.remove(); destMarker = null; }
      bubbleMarkers.forEach(m => m.remove());
      bubbleMarkers = [];
      followUser = true;
      if (lat && lon) map.easeTo({ center: [lon, lat], zoom: 15, pitch: 0, bearing: 0, duration: 600 });
      pitch = 0; bearing = 0;
    };

    // ---------- burbujas con el nombre de las calles que cruzan la ruta ----------
    function dist(a, b) {
      const kx = 111320 * Math.cos(a[1] * Math.PI / 180);
      return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540);
    }
    function inter(a, b, c, d) {
      const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-14) return null;
      const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
      const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) return null;
      return { pt: [a[0] + t * r[0], a[1] + t * r[1]], r: r, s: s, t: t };
    }
    const OK_CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'minor', 'residential', 'living_street', 'unclassified'];

    function updateBubbles() {
      bubbleMarkers.forEach(m => m.remove());
      bubbleMarkers = [];
      if (!routeCoords || !userMarker) return;
      const me = userMarker.getLngLat();
      const mePt = [me.lng, me.lat];
      let i0 = 0, best = Infinity;
      for (let i = 0; i < routeCoords.length; i++) {
        const d = dist(mePt, [routeCoords[i][1], routeCoords[i][0]]);
        if (d < best) { best = d; i0 = i; }
      }
      const ahead = [[routeCoords[i0][1], routeCoords[i0][0]]];
      let acc = 0;
      for (let i = i0 + 1; i < routeCoords.length && acc < 700; i++) {
        const p = [routeCoords[i][1], routeCoords[i][0]];
        acc += dist(ahead[ahead.length - 1], p);
        ahead.push(p);
      }
      if (ahead.length < 2) return;

      const feats = map.queryRenderedFeatures().filter(f =>
        f.sourceLayer === 'transportation' && f.properties && f.properties.name &&
        OK_CLASSES.indexOf(f.properties.class) >= 0 &&
        (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'));

      const found = {};
      feats.forEach(f => {
        const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
        lines.forEach(line => {
          for (let j = 0; j < line.length - 1; j++) {
            for (let k = 0; k < ahead.length - 1; k++) {
              const x = inter(ahead[k], ahead[k + 1], line[j], line[j + 1]);
              if (!x) continue;
              // se ignora la misma calle de la ruta (casi paralela)
              const cosA = Math.abs(x.r[0] * x.s[0] + x.r[1] * x.s[1]) / (Math.hypot(x.r[0], x.r[1]) * Math.hypot(x.s[0], x.s[1]));
              if (cosA > 0.9) continue;
              const key = f.properties.name;
              const order = k + x.t;
              if (!found[key] || order < found[key].order) found[key] = { name: key, pt: x.pt, r: x.r, s: x.s, ow: Number(f.properties.oneway) || 0, order: order };
              return;
            }
          }
        });
      });

      Object.keys(found).map(k => found[k]).sort((a, b) => a.order - b.order).slice(0, 6).forEach(c => {
        let dv = c.s;
        if (c.ow === -1) dv = [-dv[0], -dv[1]];
        else if (c.ow !== 1) {
          // calle de doble sentido: la burbuja sale por la derecha de la marcha
          const cross = c.r[0] * dv[1] - c.r[1] * dv[0];
          if (cross > 0) dv = [-dv[0], -dv[1]];
        }
        const p1 = map.project(c.pt);
        const p2 = map.project([c.pt[0] + dv[0] * 0.0005, c.pt[1] + dv[1] * 0.0005]);
        const right = (p2.x - p1.x) >= 0;
        const el = document.createElement('div');
        el.className = 'bubble ' + (right ? 'r' : 'l');
        el.textContent = c.name.length > 24 ? c.name.slice(0, 23) + '…' : c.name;
        bubbleMarkers.push(new maplibregl.Marker({ element: el, anchor: right ? 'left' : 'right', offset: [right ? 12 : -12, 0] }).setLngLat(c.pt).addTo(map));
      });
    }
  </script>
</body>
</html>
`;

export default function GpsUruguayScreen() {
  useKeepAwake(); // la pantalla no se apaga mientras la app está abierta
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
  const navRef = useRef<NavState | null>(null);
  const userPosRef = useRef<{ lat: number; lon: number; fix: boolean }>({
    lat: -34.9011,
    lon: -56.1645,
    fix: false,
  });
  const mapReadyRef = useRef<boolean>(false);
  const speechLangRef = useRef<string>('es-US');
  const pendingRef = useRef<(() => void) | null>(null);
  const overviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [navInstruction, setNavInstruction] = useState<{
    arrow: string;
    text: string;
    distM: number;
  } | null>(null);

  const [navAfter, setNavAfter] = useState<{ arrow: string; text: string } | null>(null);
  const [remaining, setRemaining] = useState<{ distM: number; min: number } | null>(null);
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('full');
  const voiceModeRef = useRef<VoiceMode>('full');

  // 'guide' = indicaciones de la ruta; 'alert' = radares y avisos importantes
  const speak = (text: string, kind: 'guide' | 'alert') => {
    const mode = voiceModeRef.current;
    if (mode === 'off') return;
    if (mode === 'alerts' && kind === 'guide') return;
    Speech.speak(text, { language: speechLangRef.current, volume: 1.0 });
  };

  const cycleVoice = () => {
    const order: VoiceMode[] = ['full', 'alerts', 'off'];
    const next = order[(order.indexOf(voiceModeRef.current) + 1) % order.length];
    voiceModeRef.current = next;
    setVoiceMode(next);
    if (next === 'off') Speech.stop();
  };

  const [favs, setFavs] = useState<Fav[]>([]);
  const favsRef = useRef<Fav[]>([]);
  const [favMenu, setFavMenu] = useState<null | 'main' | 'deleteType' | 'deleteList'>(null);
  const [deleteType, setDeleteType] = useState<'radar' | 'poi'>('radar');
  const [form, setForm] = useState<Fav | null>(null);
  const [placing, setPlacing] = useState<null | 'radar' | 'poi'>(null);
  const placingRef = useRef<null | 'radar' | 'poi'>(null);

  const saveFavs = (list: Fav[]) => {
    favsRef.current = list;
    setFavs(list);
    AsyncStorage.setItem('favoritos_v1', JSON.stringify(list)).catch(() => {});
  };

  useEffect(() => {
    AsyncStorage.getItem('favoritos_v1')
      .then((v) => {
        if (v) {
          const l = JSON.parse(v);
          favsRef.current = l;
          setFavs(l);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mapReady) {
      webViewRef.current?.injectJavaScript(
        `if (window.setFavorites) { window.setFavorites(${JSON.stringify(favs)}); } true;`
      );
    }
  }, [favs, mapReady]);

  const newFav = (type: 'radar' | 'poi', lat: number, lon: number): Fav => ({
    id: String(Date.now()),
    type,
    lat,
    lon,
    name: '',
    note: '',
    icon: type === 'radar' ? '!' : '📍',
    color: type === 'radar' ? '#dc2626' : '#2563eb',
    speed: '',
  });

  const setPlaceMode = (on: boolean) => {
    webViewRef.current?.injectJavaScript(
      `if (window.setPlaceMode) { window.setPlaceMode(${on}); } true;`
    );
  };

  const startAdd = (type: 'radar' | 'poi') => {
    setFavMenu(null);
    Alert.alert('Ubicación del punto', '¿Dónde lo colocas?', [
      {
        text: 'Mi ubicación',
        onPress: () => {
          const p = userPosRef.current;
          setForm(newFav(type, p.lat, p.lon));
        },
      },
      {
        text: 'Tocar en el mapa',
        onPress: () => {
          placingRef.current = type;
          setPlacing(type);
          setPlaceMode(true);
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const handleMessage = (e: any) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === 'place' && placingRef.current) {
        const t = placingRef.current;
        placingRef.current = null;
        setPlacing(null);
        setPlaceMode(false);
        setForm(newFav(t, m.lat, m.lon));
      } else if (m.type === 'fav') {
        const f = favsRef.current.find((x) => x.id === m.id);
        if (f) setForm({ ...f });
      }
    } catch {}
  };

  const saveForm = () => {
    if (!form) return;
    const item = { ...form, name: form.name.trim() || (form.type === 'radar' ? 'Radar propio' : 'Punto') };
    const exists = favsRef.current.some((x) => x.id === item.id);
    saveFavs(exists ? favsRef.current.map((x) => (x.id === item.id ? item : x)) : [...favsRef.current, item]);
    setForm(null);
  };

  const removeFav = (id: string) => {
    saveFavs(favsRef.current.filter((x) => x.id !== id));
    setForm(null);
  };

  const finishNavigation = () => {
    navRef.current = null;
    setNavInstruction(null);
    setNavAfter(null);
    setRemaining(null);
    setRouteInfo(null);
    setSearchQuery('');
    webViewRef.current?.injectJavaScript(
      `if (window.clearRoute) { window.clearRoute(); } true;`
    );
  };

  // Se llama con cada posición nueva: avanza los pasos y da avisos por voz
  const updateNavigation = (lat: number, lon: number) => {
    const nav = navRef.current;
    if (!nav) return;

    if (getDistanceMeters(lat, lon, nav.destLat, nav.destLon) < 40) {
      speak('Llegaste a tu destino.', 'guide');
      finishNavigation();
      return;
    }

    // Si te alejas más de 50 m de la ruta, se recalcula desde donde estás
    const off = distToRouteMeters(lat, lon, nav.coords);
    nav.offCount = off > 50 ? nav.offCount + 1 : 0;
    if (nav.offCount >= 2 && Date.now() - nav.lastRecalc > 15000) {
      nav.lastRecalc = Date.now();
      nav.offCount = 0;
      speak('Recalculando ruta', 'guide');
      runRoute('', { lat: nav.destLat, lon: nav.destLon, label: nav.destLabel }, true);
      return;
    }

    // Pasa al siguiente paso cuando ya se cruzó la maniobra actual
    while (nav.idx + 1 < nav.steps.length - 1) {
      const [mLon, mLat] = nav.steps[nav.idx + 1].maneuver.location;
      if (getDistanceMeters(lat, lon, mLat, mLon) < 25) {
        nav.idx += 1;
        nav.said = 0;
      } else {
        break;
      }
    }

    const next = nav.steps[nav.idx + 1];
    if (!next) return;
    const [nLon, nLat] = next.maneuver.location;
    const dist = getDistanceMeters(lat, lon, nLat, nLon);
    const { arrow, text } = stepInstruction(next);
    setNavInstruction({ arrow, text, distM: dist });
    const after = nav.steps[nav.idx + 2];
    setNavAfter(after ? stepInstruction(after) : null);

    let remDist = dist;
    for (let j = nav.idx + 1; j < nav.steps.length; j++) remDist += nav.steps[j].distance;
    setRemaining({
      distM: remDist,
      min: Math.max(1, Math.round((nav.totalMin * remDist) / Math.max(1, nav.totalDist))),
    });

    if (dist < 80 && nav.said < 2) {
      nav.said = 2;
      speak(`Ahora, ${text.toLowerCase()}`, 'guide');
    } else if (dist < 350 && nav.said < 1) {
      nav.said = 1;
      speak(`En ${fmtDist(dist)}, ${text.toLowerCase()}`, 'guide');
    }
  };

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
      userPosRef.current = { ...initCoords, fix: true };

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
          userPosRef.current = { lat, lon, fix: true };
          setSpeedKmh(currentSpeed);

          webViewRef.current?.injectJavaScript(
            `if (window.updateUserLocation) { window.updateUserLocation(${lat}, ${lon}, ${loc.coords.heading ?? -1}, ${currentSpeed}); } true;`
          );

          checkNearbyRadars(lat, lon);
          updateNavigation(lat, lon);
        }
      );
    })();

    return () => {
      if (subscriber) subscriber.remove();
    };
  }, []);

  // Busca una voz en español instalada en el teléfono (es-UY casi nunca existe)
  useEffect(() => {
    (async () => {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const norm = (l: string) => l.replace('_', '-').toLowerCase();
        const prefs = ['es-UY', 'es-AR', 'es-419', 'es-US', 'es-MX', 'es-ES'];
        for (const l of prefs) {
          if (voices.some((v) => norm(v.language) === l.toLowerCase())) {
            speechLangRef.current = l;
            return;
          }
        }
        const any = voices.find((v) => norm(v.language).startsWith('es'));
        if (any) speechLangRef.current = any.language.replace('_', '-');
      } catch {}
    })();
  }, []);

  // Enlaces que abren la app desde otras apps (geo: y google.navigation:)
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      const dest = parseNavUrl(url);
      if (dest) openDestination(dest);
    };
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
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

    const customRadars: Radar[] = favsRef.current
      .filter((f) => f.type === 'radar')
      .map((f) => ({
        id: f.id,
        name: f.name || 'Radar propio',
        lat: f.lat,
        lon: f.lon,
        zone: f.speed ? `${f.speed} km/h` : 'Radar propio',
      }));
    for (const r of [...RADARES_URUGUAY, ...customRadars]) {
      const d = getDistanceMeters(lat, lon, r.lat, r.lon);
      if (d <= 500 && d < minDist) {
        minDist = d;
        closest = r;
      }
    }

    setActiveRadar(closest);

    if (closest && lastAlertedId.current !== closest.id) {
      lastAlertedId.current = closest.id;
      speak(`Atención, radar de velocidad a ${Math.round(minDist)} metros.`, 'alert');
    } else if (!closest) {
      lastAlertedId.current = null;
    }
  };

  const getOrigin = async () => {
    if (!userPosRef.current.fix) {
      try {
        const p = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        userPosRef.current = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          fix: true,
        };
      } catch {}
    }
    return userPosRef.current.fix ? userPosRef.current : null;
  };

  const runRoute = async (
    query: string,
    preset?: { lat: number; lon: number; label: string },
    recalc?: boolean
  ) => {
    if (!query && !preset) return;

    setLoadingRoute(true);
    try {
      let destLat: number;
      let destLon: number;
      let destLabel: string;

      if (preset) {
        destLat = preset.lat;
        destLon = preset.lon;
        destLabel = preset.label;
      } else {
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=uy&limit=1&q=${encodeURIComponent(
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

      destLat = parseFloat(geoData[0].lat);
      destLon = parseFloat(geoData[0].lon);
      const addr = geoData[0].address || {};
      const street = addr.road || addr.pedestrian || addr.neighbourhood || addr.suburb;
      const typedNumber = query.match(/\d+\s*$/)?.[0]?.trim();
      const number = typedNumber || String(addr.house_number || '').split(';')[0];
      destLabel = street
        ? [street, number].filter(Boolean).join(' ')
        : geoData[0].display_name.split(',').slice(0, 2).join(', ');
      }

      const origin = await getOrigin();
      if (!origin) {
        Alert.alert('Sin ubicación', 'Activa el GPS y el permiso de ubicación, y vuelve a intentar.');
        setLoadingRoute(false);
        return;
      }

      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;
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

      const steps: NavStep[] = bestRoute.legs?.[0]?.steps ?? [];
      if (steps.length > 1) {
        navRef.current = {
          steps,
          idx: 0,
          said: 0,
          destLat,
          destLon,
          destLabel,
          coords: latLngCoords,
          totalDist: bestRoute.distance,
          totalMin: Math.max(1, bestRoute.duration / 60),
          offCount: 0,
          lastRecalc: recalc ? Date.now() : 0,
        };
        const first = stepInstruction(steps[1]);
        setNavInstruction({ arrow: first.arrow, text: first.text, distM: steps[0].distance });
        setNavAfter(steps[2] ? stepInstruction(steps[2]) : null);
        setRemaining({ distM: bestRoute.distance, min: durationMin });
      } else {
        navRef.current = null;
        setNavInstruction(null);
      }

      const coordsJson = JSON.stringify(latLngCoords);
      const safeLabel = JSON.stringify(destLabel);
      webViewRef.current?.injectJavaScript(
        `if (window.drawRoute) { window.drawRoute(${coordsJson}, ${destLat}, ${destLon}, ${safeLabel}, ${!recalc}); } true;`
      );

      if (navRef.current && !recalc) {
        if (overviewTimer.current) clearTimeout(overviewTimer.current);
        overviewTimer.current = setTimeout(() => {
          if (!navRef.current) return;
          const p = userPosRef.current;
          webViewRef.current?.injectJavaScript(
            `if (window.startNav) { window.startNav(${p.lat}, ${p.lon}); } true;`
          );
        }, 5000);
      }

      if (!recalc) {
        speak(
          `Ruta calculada hacia ${destLabel}. Distancia ${distanceKm} kilómetros, tiempo estimado ${durationMin} minutos.`,
          'guide'
        );
      }
    } catch (err) {
      if (!recalc) Alert.alert('Error de conexión', 'Verifica tu conexión a internet para calcular la ruta.');
    } finally {
      setLoadingRoute(false);
    }
  };

  const handleSearchAndRoute = () => runRoute(searchQuery.trim());

  // Destino que llega desde otra app: espera a que el mapa cargue y calcula la ruta
  const openDestination = (dest: ExternalDest) => {
    const go = () => {
      if (dest.lat !== undefined && dest.lon !== undefined) {
        const label = dest.label || 'Destino';
        setSearchQuery(label);
        runRoute('', { lat: dest.lat, lon: dest.lon, label });
      } else if (dest.query) {
        setSearchQuery(dest.query);
        runRoute(dest.query);
      }
    };
    if (mapReadyRef.current) go();
    else pendingRef.current = go;
  };

  const handleClearRoute = () => {
    navRef.current = null;
    setNavInstruction(null);
    setNavAfter(null);
    setRemaining(null);
    setRouteInfo(null);
    setSearchQuery('');
    webViewRef.current?.injectJavaScript(
      `if (window.clearRoute) { window.clearRoute(${location.lat}, ${location.lon}); } true;`
    );
  };

  const handleRecenter = () => {
    const p = userPosRef.current;
    webViewRef.current?.injectJavaScript(
      navRef.current
        ? `if (window.startNav) { window.startNav(${p.lat}, ${p.lon}); } true;`
        : `if (window.centerOnUser) { window.centerOnUser(${p.lat}, ${p.lon}); } true;`
    );
  };

  const handleToggleOverview = () => {
    const p = userPosRef.current;
    webViewRef.current?.injectJavaScript(
      `if (window.toggleOverview) { window.toggleOverview(${p.lat}, ${p.lon}); } true;`
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

      {navInstruction && (
        <View>
          <View style={styles.navBanner}>
            <Text style={styles.navArrow}>{navInstruction.arrow}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.navDist}>{fmtDist(navInstruction.distM)}</Text>
              <Text style={styles.navText} numberOfLines={2}>
                {navInstruction.text}
              </Text>
            </View>
          </View>
          {navAfter && (
            <View style={styles.navNext}>
              <Text style={styles.navNextArrow}>{navAfter.arrow}</Text>
              <Text style={styles.navNextText} numberOfLines={1}>
                Luego: {navAfter.text}
              </Text>
            </View>
          )}
        </View>
      )}

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
        onMessage={handleMessage}
        androidLayerType="hardware"
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onLoadEnd={() => {
          setMapReady(true);
          mapReadyRef.current = true;
          if (pendingRef.current) {
            const run = pendingRef.current;
            pendingRef.current = null;
            run();
          }
        }}
      />

      <View style={styles.sideButtons}>
        {routeInfo && (
          <TouchableOpacity style={styles.roundBtn} onPress={handleToggleOverview}>
            <Text style={styles.roundBtnText}>⤢</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.roundBtn} onPress={handleRecenter}>
          <View style={styles.dotRing}>
            <View style={styles.dotCore} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.roundBtn} onPress={() => setFavMenu('main')}>
          <Text style={styles.voiceText}>FAV</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.roundBtn} onPress={cycleVoice}>
          <Text style={styles.voiceText}>
            {voiceMode === 'full' ? 'VOZ' : voiceMode === 'alerts' ? 'ALERTAS' : 'MUDO'}
          </Text>
        </TouchableOpacity>
      </View>

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
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>
                  {fmtClock(remaining ? remaining.min : routeInfo.durationMin)}
                </Text>
                <Text style={styles.statLabel}>llegada</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>
                  {remaining ? remaining.min : routeInfo.durationMin}
                </Text>
                <Text style={styles.statLabel}>min</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>
                  {remaining ? (remaining.distM / 1000).toFixed(1) : routeInfo.distanceKm}
                </Text>
                <Text style={styles.statLabel}>km</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearRoute}>
            <Text style={styles.clearBtnText}>Finalizar</Text>
          </TouchableOpacity>
        </View>
      )}
      {placing && (
        <View style={styles.placingBanner}>
          <Text style={styles.placingText}>Toca el mapa para colocar el punto</Text>
          <TouchableOpacity
            onPress={() => {
              placingRef.current = null;
              setPlacing(null);
              setPlaceMode(false);
            }}
          >
            <Text style={styles.placingCancel}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={favMenu !== null} transparent animationType="fade" onRequestClose={() => setFavMenu(null)}>
        <View style={styles.modalBack}>
          <View style={styles.sheet}>
            {favMenu === 'main' && (
              <>
                <Text style={styles.sheetTitle}>Favoritos</Text>
                <TouchableOpacity style={styles.sheetBtn} onPress={() => startAdd('radar')}>
                  <Text style={styles.sheetBtnText}>Agregar radar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetBtn} onPress={() => startAdd('poi')}>
                  <Text style={styles.sheetBtnText}>Agregar punto de interés</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetBtn} onPress={() => setFavMenu('deleteType')}>
                  <Text style={styles.sheetBtnText}>Eliminar</Text>
                </TouchableOpacity>
              </>
            )}
            {favMenu === 'deleteType' && (
              <>
                <Text style={styles.sheetTitle}>¿Qué quieres eliminar?</Text>
                <TouchableOpacity style={styles.sheetBtn} onPress={() => { setDeleteType('radar'); setFavMenu('deleteList'); }}>
                  <Text style={styles.sheetBtnText}>Radar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetBtn} onPress={() => { setDeleteType('poi'); setFavMenu('deleteList'); }}>
                  <Text style={styles.sheetBtnText}>Punto de interés</Text>
                </TouchableOpacity>
              </>
            )}
            {favMenu === 'deleteList' && (
              <>
                <Text style={styles.sheetTitle}>
                  {deleteType === 'radar' ? 'Radares propios' : 'Puntos de interés'}
                </Text>
                <ScrollView style={{ maxHeight: 280 }}>
                  {favs.filter((f) => f.type === deleteType).length === 0 && (
                    <Text style={styles.sheetEmpty}>No hay puntos guardados.</Text>
                  )}
                  {favs.filter((f) => f.type === deleteType).map((f) => (
                    <TouchableOpacity
                      key={f.id}
                      style={styles.sheetBtn}
                      onPress={() =>
                        Alert.alert('Eliminar', `¿Eliminar "${f.name}"?`, [
                          { text: 'Cancelar', style: 'cancel' },
                          { text: 'Eliminar', style: 'destructive', onPress: () => removeFav(f.id) },
                        ])
                      }
                    >
                      <Text style={styles.sheetBtnText}>
                        {f.type === 'poi' ? f.icon + '  ' : ''}{f.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
            <TouchableOpacity style={styles.sheetClose} onPress={() => setFavMenu(null)}>
              <Text style={styles.sheetCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={form !== null} transparent animationType="fade" onRequestClose={() => setForm(null)}>
        <View style={styles.modalBack}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
            {form && (
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>
                  {form.type === 'radar' ? 'Radar' : 'Punto de interés'}
                </Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="Nombre"
                  placeholderTextColor="#9ca3af"
                  value={form.name}
                  onChangeText={(t) => setForm({ ...form, name: t })}
                />
                {form.type === 'radar' && (
                  <TextInput
                    style={styles.formInput}
                    placeholder="Velocidad máxima (km/h)"
                    placeholderTextColor="#9ca3af"
                    keyboardType="numeric"
                    value={form.speed}
                    onChangeText={(t) => setForm({ ...form, speed: t.replace(/[^0-9]/g, '').slice(0, 3) })}
                  />
                )}
                <TextInput
                  style={[styles.formInput, { height: 70 }]}
                  placeholder="Comentarios"
                  placeholderTextColor="#9ca3af"
                  multiline
                  value={form.note}
                  onChangeText={(t) => setForm({ ...form, note: t })}
                />
                {form.type === 'poi' && (
                  <View style={styles.pickRow}>
                    {FAV_ICONS.map((ic) => (
                      <TouchableOpacity
                        key={ic}
                        style={[styles.iconPick, form.icon === ic && styles.pickOn]}
                        onPress={() => setForm({ ...form, icon: ic })}
                      >
                        <Text style={{ fontSize: 20 }}>{ic}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <View style={styles.pickRow}>
                  {FAV_COLORS.map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.colorPick, { backgroundColor: c }, form.color === c && styles.pickOn]}
                      onPress={() => setForm({ ...form, color: c })}
                    />
                  ))}
                </View>
                <TouchableOpacity style={styles.sheetBtn} onPress={saveForm}>
                  <Text style={styles.sheetBtnText}>Guardar</Text>
                </TouchableOpacity>
                {favs.some((x) => x.id === form.id) && (
                  <TouchableOpacity style={styles.sheetBtn} onPress={() => removeFav(form.id)}>
                    <Text style={styles.sheetBtnText}>Eliminar</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.sheetClose} onPress={() => setForm(null)}>
                  <Text style={styles.sheetCloseText}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
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
  navBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#404040',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  navNext: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#404040',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  navNextArrow: { color: '#d4d4d4', fontSize: 20, width: 64, textAlign: 'center', marginRight: 8 },
  navNextText: { color: '#d4d4d4', fontSize: 14, flex: 1 },
  sideButtons: { position: 'absolute', right: 12, bottom: 130, alignItems: 'center' },
  roundBtn: {
    minWidth: 52,
    height: 52,
    paddingHorizontal: 6,
    borderRadius: 26,
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    elevation: 5,
  },
  roundBtnText: { color: '#ffffff', fontSize: 24, fontWeight: 'bold' },
  voiceText: { color: '#ffffff', fontSize: 10, fontWeight: 'bold' },
  dotRing: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotCore: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ffffff' },
  statsRow: { flexDirection: 'row', marginTop: 6 },
  statCell: { marginRight: 26 },
  statValue: { color: '#ffffff', fontSize: 20, fontWeight: 'bold' },
  statLabel: { color: '#9ca3af', fontSize: 12 },
  placingBanner: {
    position: 'absolute',
    top: 120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    elevation: 6,
  },
  placingText: { color: '#ffffff', fontSize: 14, fontWeight: 'bold' },
  placingCancel: { color: '#9ca3af', fontSize: 14, marginLeft: 14 },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#000000', borderWidth: 1, borderColor: '#404040', borderRadius: 16, padding: 16 },
  sheetTitle: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  sheetEmpty: { color: '#9ca3af', fontSize: 14, marginBottom: 8 },
  sheetBtn: { borderWidth: 1, borderColor: '#404040', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  sheetBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  sheetClose: { paddingVertical: 10, alignItems: 'center' },
  sheetCloseText: { color: '#9ca3af', fontSize: 15 },
  formInput: { borderWidth: 1, borderColor: '#404040', borderRadius: 10, color: '#ffffff', fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  iconPick: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 6, marginBottom: 6 },
  colorPick: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#262626', marginRight: 10, marginBottom: 6 },
  pickOn: { borderColor: '#ffffff' },
  navArrow: {
    color: '#ffffff',
    fontSize: 44,
    width: 64,
    textAlign: 'center',
    marginRight: 8,
  },
  navDist: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  navText: {
    color: '#d4d4d4',
    fontSize: 15,
    marginTop: 2,
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
