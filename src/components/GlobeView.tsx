import { useEffect, useRef, useState, Fragment, useMemo } from 'react';
import * as Cesium from 'cesium';
import { Viewer, ImageryLayer, Entity, BillboardGraphics, CylinderGraphics, PointGraphics, PolylineGraphics } from 'resium';
import { useSpacecraftTracking } from '../hooks/useSpacecraftTracking';
import { useOrbitalDebris } from '../hooks/useOrbitalDebris';
import { type KesslerSimState, CASCADE_APPROACH_MS, FINAL_APPROACH_MS, FINAL_HIGHLIGHT_STAGGER_MS, FINAL_DEBRIS_COUNTS } from '../types/kessler';

Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? '';

const SHARD_SVGS = [
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><polygon points="3,6 12,2 14,13 4,11" fill="%2394a3b8" stroke="%23475569" stroke-width="1.5"/></svg>`,
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><polygon points="2,8 8,3 13,8 9,14 3,11" fill="%23cbd5e1" stroke="%2364748b" stroke-width="1.5"/></svg>`,
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><polygon points="4,2 12,4 14,12 8,14 2,8" fill="%2364748b" stroke="%23334155" stroke-width="1.5"/></svg>`
];

const FLASH_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23ffffff" stop-opacity="1"/><stop offset="30%" stop-color="%23fef08a" stop-opacity="0.9"/><stop offset="70%" stop-color="%23f97316" stop-opacity="0.4"/><stop offset="100%" stop-color="%23ef4444" stop-opacity="0"/></radialGradient><circle cx="64" cy="64" r="60" fill="url(%23g)"/></svg>`;

const SHOCKWAVE_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="64" r="60" fill="none" stroke="%23f8fafc" stroke-width="3" opacity="0.9"/></svg>`;

const CRIMSON_DEBRIS_GLOW = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><radialGradient id="rg" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23fca5a5" stop-opacity="0.95"/><stop offset="55%" stop-color="%23ef4444" stop-opacity="0.45"/><stop offset="100%" stop-color="%237f1d1d" stop-opacity="0"/></radialGradient><circle cx="16" cy="16" r="14" fill="url(%23rg)"/></svg>`;

const BLUE_TARGET_GLOW = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><radialGradient id="bg" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%2393c5fd" stop-opacity="0.9"/><stop offset="50%" stop-color="%233b82f6" stop-opacity="0.35"/><stop offset="100%" stop-color="%231e3a8a" stop-opacity="0"/></radialGradient><circle cx="64" cy="64" r="58" fill="url(%23bg)"/></svg>`;

interface KesslerDebrisItem {
  id: string;
  positionProperty: Cesium.CallbackProperty;
  rotationProperty: Cesium.CallbackProperty;
  image: string;
  velocity: Cesium.Cartesian3;
  burstDirection: Cesium.Cartesian3;
  burstSpeed: number;
  spawnOrigin: Cesium.Cartesian3;
  spawnLon: number;
  spawnLat: number;
  spawnHeight: number;
  spawnTime: number;
  orbitalLonSpeed: number;
  orbitalLonOffset: number;
  orbitalLatOffset: number;
  orbitalInclination: number;
  orbitalPhaseOffset: number;
  orbitalAltitudeOffset: number;
  rotationSpeed: number;
  rotationPhase: number;
  scaleFactor: number;
  isDangerous?: boolean;
}

const DEBRIS_BURST_PEAK_SEC = 0.85;
const DEBRIS_BURST_DECAY_SEC = 1.6;
const DEBRIS_ORBIT_ALT_RAMP_SEC = 2.0;

function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function burstWeightAt(elapsedSec: number): number {
  if (elapsedSec <= DEBRIS_BURST_PEAK_SEC) {
    return 1 + 0.65 * Math.exp(-elapsedSec / 0.22);
  }
  return 1 - smoothstep01((elapsedSec - DEBRIS_BURST_PEAK_SEC) / DEBRIS_BURST_DECAY_SEC);
}

/** Evenly distributed sphere directions in local ENU at the collision point — no global-axis bias. */
function generateIsotropicBurstDirection(
  origin: Cesium.Cartesian3,
  index: number,
  count: number
): Cesium.Cartesian3 {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const up = 1 - ((index + 0.5) / count) * 2;
  const ringRadius = Math.sqrt(Math.max(0, 1 - up * up));
  const theta = goldenAngle * index + Math.random() * 0.4;

  const jitter = 0.1 + (index % 7) * 0.025;
  const localDir = new Cesium.Cartesian3(
    Math.cos(theta) * ringRadius + (Math.random() - 0.5) * jitter,
    Math.sin(theta) * ringRadius + (Math.random() - 0.5) * jitter,
    up + (Math.random() - 0.5) * jitter
  );
  Cesium.Cartesian3.normalize(localDir, localDir);

  const enuToFixed = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const ecefDir = Cesium.Matrix4.multiplyByPointAsVector(
    enuToFixed,
    localDir,
    new Cesium.Cartesian3()
  );
  Cesium.Cartesian3.normalize(ecefDir, ecefDir);
  return ecefDir;
}

function computeBurstResidualOffset(debris: KesslerDebrisItem, elapsedSec: number): Cesium.Cartesian3 {
  const displacement = new Cesium.Cartesian3(0, 0, 0);
  if (elapsedSec <= 0) return displacement;

  const stepSize = 0.025;
  const steps = Math.max(1, Math.ceil(elapsedSec / stepSize));
  const dt = elapsedSec / steps;

  const burstVec = Cesium.Cartesian3.multiplyByScalar(
    debris.burstDirection,
    debris.burstSpeed,
    new Cesium.Cartesian3()
  );

  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const weight = burstWeightAt(t);
    Cesium.Cartesian3.add(
      displacement,
      Cesium.Cartesian3.multiplyByScalar(burstVec, weight * dt, new Cesium.Cartesian3()),
      displacement
    );
  }

  return displacement;
}

/** Each fragment follows its own orbital lane with unique speed, inclination, and altitude. */
function computeIndependentOrbitPosition(debris: KesslerDebrisItem, elapsedSec: number): Cesium.Cartesian3 {
  const orbitBlend = smoothstep01(elapsedSec / DEBRIS_ORBIT_ALT_RAMP_SEC);

  const lon =
    debris.spawnLon +
    elapsedSec * debris.orbitalLonSpeed +
    debris.orbitalLonOffset * orbitBlend;

  const lonRad = lon * Cesium.Math.RADIANS_PER_DEGREE;
  const spawnLonRad = debris.spawnLon * Cesium.Math.RADIANS_PER_DEGREE;

  const lat =
    debris.spawnLat +
    debris.orbitalLatOffset * orbitBlend +
    debris.orbitalInclination *
      orbitBlend *
      (Math.sin(lonRad + debris.orbitalPhaseOffset) - Math.sin(spawnLonRad + debris.orbitalPhaseOffset));

  const altBlend = Math.min(1, elapsedSec / DEBRIS_ORBIT_ALT_RAMP_SEC);
  const height = debris.spawnHeight + debris.orbitalAltitudeOffset * altBlend;

  return Cesium.Ellipsoid.WGS84.cartographicToCartesian(
    Cesium.Cartographic.fromDegrees(lon, lat, Math.max(height, 180000))
  );
}

interface FinalCascadePair {
  debrisId: string;
  satId: string;
}

interface FinalImpactEffect {
  position: Cesium.Cartesian3;
  time: number;
}

const FINAL_PHASE_STATES: KesslerSimState[] = [
  'final_highlight',
  'final_approach',
  'final_impact_1',
  'final_impact_2',
  'final_impact_3',
  'kessler_cascade_active',
];

function isFinalPhaseState(state: KesslerSimState): boolean {
  return FINAL_PHASE_STATES.includes(state);
}

function isStateAtOrAfter(current: KesslerSimState, target: KesslerSimState): boolean {
  return FINAL_PHASE_STATES.indexOf(current) >= FINAL_PHASE_STATES.indexOf(target);
}

function getDebrisWorldPosition(debris: KesslerDebrisItem, atTimeMs: number = Date.now()) {
  const elapsedSec = (atTimeMs - debris.spawnTime) / 1000;
  const orbitPos = computeIndependentOrbitPosition(debris, elapsedSec);
  const burstOffset = computeBurstResidualOffset(debris, elapsedSec);

  const orbitBlend = smoothstep01(elapsedSec / DEBRIS_ORBIT_ALT_RAMP_SEC);
  const spawnOrbitPos = computeIndependentOrbitPosition(debris, 0);
  const orbitDrift = Cesium.Cartesian3.subtract(orbitPos, spawnOrbitPos, new Cesium.Cartesian3());

  return Cesium.Cartesian3.add(
    Cesium.Cartesian3.add(debris.spawnOrigin, burstOffset, new Cesium.Cartesian3()),
    Cesium.Cartesian3.multiplyByScalar(orbitDrift, orbitBlend, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
}

function generateKesslerDebrisFragments(
  origin: Cesium.Cartesian3,
  count: number,
  idPrefix: string,
  spawnTime: number = Date.now()
): KesslerDebrisItem[] {
  const spawnCarto = Cesium.Cartographic.fromCartesian(origin);
  const spawnLon = Cesium.Math.toDegrees(spawnCarto.longitude);
  const spawnLat = Cesium.Math.toDegrees(spawnCarto.latitude);
  const spawnHeight = spawnCarto.height;
  const spawnOrigin = Cesium.Cartesian3.clone(origin);

  const debrisList: KesslerDebrisItem[] = [];
  for (let i = 0; i < count; i++) {
    const burstDirection = generateIsotropicBurstDirection(spawnOrigin, i, count);
    const speedSpread = 0.45 + (i % 11) * 0.09 + Math.random() * 0.85;
    const burstSpeed = (32000 + Math.pow(Math.random(), 0.55) * 148000) * speedSpread;
    const velocity = Cesium.Cartesian3.multiplyByScalar(burstDirection, burstSpeed, new Cesium.Cartesian3());

    const lonSpeedMag = (0.45 + Math.random() * 1.05) * 1.8;
    const orbitalLonSpeed = (Math.random() < 0.5 ? -1 : 1) * lonSpeedMag;
    const orbitalLonOffset = (Math.random() - 0.5) * 5.5;
    const orbitalLatOffset = (Math.random() - 0.5) * 4.5;
    const orbitalInclination = 1.5 + Math.random() * 14;
    const orbitalPhaseOffset = Math.random() * Math.PI * 2;
    const orbitalAltitudeOffset = (Math.random() - 0.5) * 140000;
    const rotationSpeed = (Math.random() - 0.5) * 7;
    const rotationPhase = Math.random() * Math.PI * 2;
    const scaleFactor = 0.72 + Math.random() * 0.56;

    const item: KesslerDebrisItem = {
      id: `${idPrefix}-${i}`,
      positionProperty: null as unknown as Cesium.CallbackProperty,
      rotationProperty: null as unknown as Cesium.CallbackProperty,
      image: SHARD_SVGS[i % 3],
      velocity,
      burstDirection,
      burstSpeed,
      spawnOrigin,
      spawnLon,
      spawnLat,
      spawnHeight,
      spawnTime,
      orbitalLonSpeed,
      orbitalLonOffset,
      orbitalLatOffset,
      orbitalInclination,
      orbitalPhaseOffset,
      orbitalAltitudeOffset,
      rotationSpeed,
      rotationPhase,
      scaleFactor,
    };

    item.positionProperty = new Cesium.CallbackProperty(() => {
      return getDebrisWorldPosition(item);
    }, false);

    item.rotationProperty = new Cesium.CallbackProperty(() => {
      const elapsedSec = (Date.now() - spawnTime) / 1000;
      return rotationPhase + rotationSpeed * elapsedSec;
    }, false);

    debrisList.push(item);
  }
  return debrisList;
}

const baseSpeed = 1.8;

// Low-level WebGL context options must be defined statically to prevent Resium
// from recreating the Viewer instance on every render cycle.
const CONTEXT_OPTIONS = {
  webgl: {
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance' as const
  },
};

interface GlobeViewProps {
  active?: boolean;
  targetLocation?: { lat: number; lng: number; label: string } | null;
  onSelectLocation?: (loc: { lat: number; lng: number }) => void;
  selectedSpacecraftId?: string;
  spacecraftFocusTrigger?: number;
  onSelectSpacecraft?: (id: string, triggerFocus?: boolean) => void;
  isGraveyard?: boolean;
  selectedFeaturedObjectId?: string | null;
  onSelectFeaturedObject?: (id: string | null) => void;
  isKessler?: boolean;
  kesslerSimState?: KesslerSimState;
  kesslerCountdown?: number;
  kesslerCollisionStartTime?: number;
  kesslerSecondaryCollisionStartTime?: number;
  kesslerFinalCollisionStartTime?: number;
  kesslerFinalHighlightStartTime?: number;
}

export default function GlobeView({ 
  active = false, 
  targetLocation = null, 
  onSelectLocation, 
  selectedSpacecraftId = "iss",
  spacecraftFocusTrigger = 0,
  onSelectSpacecraft,
  isGraveyard = false,
  selectedFeaturedObjectId = null,
  onSelectFeaturedObject,
  isKessler = false,
  kesslerSimState = 'idle',
  kesslerCountdown = 5,
  kesslerCollisionStartTime = 0,
  kesslerSecondaryCollisionStartTime = 0,
  kesslerFinalCollisionStartTime = 0,
  kesslerFinalHighlightStartTime = 0,
}: GlobeViewProps) {
  const { spacecrafts } = useSpacecraftTracking();
  const { debris } = useOrbitalDebris(isGraveyard);
  const [hoveredEntity, setHoveredEntity] = useState<string | null>(null);
  const [popupEntity, setPopupEntity] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const [imageryProvider, setImageryProvider] = useState<any>(null);
  const [isGlobeReady, setIsGlobeReady] = useState(false);
  const lastInteractionTimeRef = useRef<number>(0);
  const isUserInteractingRef = useRef<boolean>(false);
  const rotationFactorRef = useRef<number>(1.0);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);

  const [issFocusBaseImage, setIssFocusBaseImage] = useState<string>('');
  const [issFocusPulseImage, setIssFocusPulseImage] = useState<string>('');
  const [isISSFocused, setIsISSFocused] = useState(false);
  const isISSFocusedRef = useRef(false);
  const issLabelRef = useRef<HTMLDivElement | null>(null);

  const selectedSpacecraftIdRef = useRef(selectedSpacecraftId);
  useEffect(() => {
    selectedSpacecraftIdRef.current = selectedSpacecraftId;
  }, [selectedSpacecraftId]);

  const isGraveyardRef = useRef(isGraveyard);
  useEffect(() => {
    isGraveyardRef.current = isGraveyard;
  }, [isGraveyard]);

  const selectedFeaturedObjectIdRef = useRef(selectedFeaturedObjectId);
  useEffect(() => {
    selectedFeaturedObjectIdRef.current = selectedFeaturedObjectId;
  }, [selectedFeaturedObjectId]);

  const onSelectFeaturedObjectRef = useRef(onSelectFeaturedObject);
  useEffect(() => {
    onSelectFeaturedObjectRef.current = onSelectFeaturedObject;
  }, [onSelectFeaturedObject]);

  const debrisRef = useRef(debris);
  useEffect(() => {
    debrisRef.current = debris;
  }, [debris]);

  const wasGraveyardRef = useRef(false);
  const isKesslerRef = useRef(isKessler);
  useEffect(() => {
    isKesslerRef.current = isKessler;
  }, [isKessler]);
  const wasKesslerRef = useRef(false);
  const originalDoubleClickRef = useRef<any>(null);
  const [kesslerSatellitesWithProperties, setKesslerSatellitesWithProperties] = useState<any[]>([]);

  const kesslerSimStateRef = useRef(kesslerSimState);
  const kesslerCountdownRef = useRef(kesslerCountdown);
  const kesslerCollisionStartTimeRef = useRef(kesslerCollisionStartTime);
  const kesslerSecondaryCollisionStartTimeRef = useRef(kesslerSecondaryCollisionStartTime);
  const kesslerFinalCollisionStartTimeRef = useRef(kesslerFinalCollisionStartTime);
  const kesslerFinalHighlightStartTimeRef = useRef(kesslerFinalHighlightStartTime);
  const freezeSecondsRef = useRef<number | null>(null);

  const [polylinePositions, setPolylinePositions] = useState<any>(null);
  const [polylineMaterial, setPolylineMaterial] = useState<any>(null);
  const [midpointPosition, setMidpointPosition] = useState<Cesium.Cartesian3 | null>(null);
  const [kesslerDebris, setKesslerDebris] = useState<KesslerDebrisItem[]>([]);
  const kesslerDebrisRef = useRef<KesslerDebrisItem[]>([]);

  const cascadeDangerousDebrisIdRef = useRef<string | null>(null);
  const cascadeTargetSatIdRef = useRef<string | null>(null);
  const cascadeSelectionDoneRef = useRef(false);
  const cascadeImpactHandledRef = useRef(false);
  const secondaryImpactTimeRef = useRef<number>(0);
  const [secondaryImpactPosition, setSecondaryImpactPosition] = useState<Cesium.Cartesian3 | null>(null);
  const [cascadeTargetSatId, setCascadeTargetSatId] = useState<string | null>(null);
  const [cascadeDangerousDebrisId, setCascadeDangerousDebrisId] = useState<string | null>(null);

  const finalCascadePairsRef = useRef<FinalCascadePair[]>([]);
  const finalCascadeSelectionDoneRef = useRef(false);
  const finalImpactsHandledRef = useRef<Set<number>>(new Set());
  const [finalCascadePairs, setFinalCascadePairs] = useState<FinalCascadePair[]>([]);
  const [finalImpactEffects, setFinalImpactEffects] = useState<FinalImpactEffect[]>([]);
  const [finalHighlightStage, setFinalHighlightStage] = useState(0);
  const finalHighlightStageRef = useRef(0);

  useEffect(() => {
    kesslerSimStateRef.current = kesslerSimState;
    if (kesslerSimState === 'frozen' && freezeSecondsRef.current === null && viewer) {
      const time = viewer.clock.currentTime;
      const elapsed = Cesium.JulianDate.secondsDifference(time, viewer.clock.startTime);
      freezeSecondsRef.current = elapsed;
    } else if (kesslerSimState !== 'frozen') {
      freezeSecondsRef.current = null;
    }
  }, [kesslerSimState, viewer]);

  useEffect(() => {
    kesslerCountdownRef.current = kesslerCountdown;
  }, [kesslerCountdown]);

  useEffect(() => {
    kesslerCollisionStartTimeRef.current = kesslerCollisionStartTime;
  }, [kesslerCollisionStartTime]);

  useEffect(() => {
    kesslerSecondaryCollisionStartTimeRef.current = kesslerSecondaryCollisionStartTime;
  }, [kesslerSecondaryCollisionStartTime]);

  useEffect(() => {
    kesslerFinalCollisionStartTimeRef.current = kesslerFinalCollisionStartTime;
  }, [kesslerFinalCollisionStartTime]);

  useEffect(() => {
    kesslerFinalHighlightStartTimeRef.current = kesslerFinalHighlightStartTime;
  }, [kesslerFinalHighlightStartTime]);

  useEffect(() => {
    finalCascadePairsRef.current = finalCascadePairs;
  }, [finalCascadePairs]);

  useEffect(() => {
    if (kesslerSimState !== 'final_highlight') {
      setFinalHighlightStage(0);
      finalHighlightStageRef.current = 0;
      return;
    }

    setFinalHighlightStage(1);
    finalHighlightStageRef.current = 1;
    const stage2 = setTimeout(() => {
      setFinalHighlightStage(2);
      finalHighlightStageRef.current = 2;
    }, FINAL_HIGHLIGHT_STAGGER_MS);
    const stage3 = setTimeout(() => {
      setFinalHighlightStage(3);
      finalHighlightStageRef.current = 3;
    }, FINAL_HIGHLIGHT_STAGGER_MS * 2);

    return () => {
      clearTimeout(stage2);
      clearTimeout(stage3);
    };
  }, [kesslerSimState]);

  useEffect(() => {
    kesslerDebrisRef.current = kesslerDebris;
  }, [kesslerDebris]);

  useEffect(() => {
    cascadeDangerousDebrisIdRef.current = cascadeDangerousDebrisId;
  }, [cascadeDangerousDebrisId]);

  useEffect(() => {
    cascadeTargetSatIdRef.current = cascadeTargetSatId;
  }, [cascadeTargetSatId]);

  useEffect(() => {
    const featACarto = Cesium.Cartographic.fromDegrees(-95.0, 39.5, 680000);
    const featAPos = Cesium.Ellipsoid.WGS84.cartographicToCartesian(featACarto);

    const featBCarto = Cesium.Cartographic.fromDegrees(-65.0, 36.5, 620000);
    const featBPos = Cesium.Ellipsoid.WGS84.cartographicToCartesian(featBCarto);

    const M = Cesium.Cartesian3.multiplyByScalar(
      Cesium.Cartesian3.add(featAPos, featBPos, new Cesium.Cartesian3()),
      0.5,
      new Cesium.Cartesian3()
    );
    setMidpointPosition(M);
  }, []);

  const flashScaleProperty = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() - kesslerCollisionStartTimeRef.current - 2000;
      if (elapsed < 0) return 0.0;
      const progress = elapsed / 600;
      if (progress > 1.0) return 0.0;
      return 6.0 * (1.0 - progress);
    }, false);
  }, []);

  const shockwaveScaleProperty = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() - kesslerCollisionStartTimeRef.current - 2000;
      if (elapsed < 0) return 0.0;
      const progress = elapsed / 800;
      if (progress > 1.0) return 0.0;
      return 12.0 * progress;
    }, false);
  }, []);

  const shockwaveColorProperty = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() - kesslerCollisionStartTimeRef.current - 2000;
      if (elapsed < 0) return Cesium.Color.WHITE.withAlpha(0.0);
      const progress = elapsed / 800;
      if (progress > 1.0) return Cesium.Color.WHITE.withAlpha(0.0);
      return Cesium.Color.WHITE.withAlpha(0.85 * (1.0 - progress));
    }, false);
  }, []);

  const secondaryFlashScaleProperty = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() - secondaryImpactTimeRef.current;
      if (elapsed < 0) return 0.0;
      const progress = elapsed / 600;
      if (progress > 1.0) return 0.0;
      return 5.0 * (1.0 - progress);
    }, false);
  }, []);

  const secondaryShockwaveScaleProperty = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() - secondaryImpactTimeRef.current;
      if (elapsed < 0) return 0.0;
      const progress = elapsed / 800;
      if (progress > 1.0) return 0.0;
      return 10.0 * progress;
    }, false);
  }, []);

  const secondaryShockwaveColorProperty = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() - secondaryImpactTimeRef.current;
      if (elapsed < 0) return Cesium.Color.WHITE.withAlpha(0.0);
      const progress = elapsed / 800;
      if (progress > 1.0) return Cesium.Color.WHITE.withAlpha(0.0);
      return Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.8 * (1.0 - progress));
    }, false);
  }, []);

  const dangerousDebrisPulseScale = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 1200;
      const progress = elapsed / 1200;
      return 1.15 + 0.2 * Math.sin(progress * Math.PI * 2);
    }, false);
  }, []);

  const dangerousDebrisPulseColor = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 1200;
      const progress = elapsed / 1200;
      const alpha = 0.65 + 0.35 * Math.sin(progress * Math.PI * 2);
      return Cesium.Color.fromCssColorString('#ef4444').withAlpha(alpha);
    }, false);
  }, []);

  const targetSatPulseScale = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 1400;
      const progress = elapsed / 1400;
      return 0.95 + 0.18 * Math.sin(progress * Math.PI * 2);
    }, false);
  }, []);

  const targetSatPulseColor = useMemo(() => {
    return new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 1400;
      const progress = elapsed / 1400;
      const alpha = 0.75 + 0.25 * Math.sin(progress * Math.PI * 2);
      return Cesium.Color.fromCssColorString('#60a5fa').withAlpha(alpha);
    }, false);
  }, []);

  useEffect(() => {
    if (!viewer) return;

    const positions = new Cesium.CallbackProperty((time) => {
      const satA = viewer.entities.getById('kessler-feat-a');
      const satB = viewer.entities.getById('kessler-feat-b');
      if (satA && satB && satA.position && satB.position) {
        const posA = satA.position.getValue(time);
        const posB = satB.position.getValue(time);
        if (posA && posB) {
          return [posA, posB];
        }
      }
      return [];
    }, false);

    const material = new Cesium.ColorMaterialProperty(
      new Cesium.CallbackProperty(() => {
        const active = kesslerSimStateRef.current !== 'idle';
        const elapsed = Date.now() % 1200;
        const progress = elapsed / 1200;
        const pulse = 0.4 + 0.6 * Math.sin(progress * Math.PI * 2);
        return Cesium.Color.fromCssColorString('#ef4444').withAlpha(pulse);
      }, false)
    );

    setPolylinePositions(positions);
    setPolylineMaterial(material);
  }, [viewer]);

  useEffect(() => {
    if (kesslerSimState === 'impact' && midpointPosition) {
      setKesslerDebris(generateKesslerDebrisFragments(midpointPosition, 45, 'kessler-debris'));
    } else if (kesslerSimState === 'idle') {
      setKesslerDebris([]);
      setCascadeDangerousDebrisId(null);
      setCascadeTargetSatId(null);
      setSecondaryImpactPosition(null);
      setFinalCascadePairs([]);
      setFinalImpactEffects([]);
      cascadeSelectionDoneRef.current = false;
      cascadeImpactHandledRef.current = false;
      cascadeDangerousDebrisIdRef.current = null;
      cascadeTargetSatIdRef.current = null;
      finalCascadeSelectionDoneRef.current = false;
      finalImpactsHandledRef.current = new Set();
      finalCascadePairsRef.current = [];
    }
  }, [kesslerSimState, midpointPosition]);

  // Phase 5: select dangerous debris and nearest target satellite
  useEffect(() => {
    if (kesslerSimState !== 'cascade_approach' || cascadeSelectionDoneRef.current) return;
    if (kesslerDebris.length === 0 || !viewer) return;

    cascadeSelectionDoneRef.current = true;

    const randomIdx = Math.floor(Math.random() * kesslerDebris.length);
    const dangerousDebris = kesslerDebris[randomIdx];
    const debrisPos = getDebrisWorldPosition(dangerousDebris);

    let nearestId: string | null = null;
    let nearestDist = Infinity;

    for (const sat of kesslerSatellitesWithProperties) {
      if (sat.isFeatured) continue;
      const time = viewer.clock.currentTime;
      const satPos = sat.positionProperty?.getValue?.(time);
      if (!satPos) continue;
      const dist = Cesium.Cartesian3.distance(debrisPos, satPos);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = sat.id;
      }
    }

    if (!nearestId) {
      nearestId = kesslerSatellitesWithProperties.find((s) => !s.isFeatured)?.id ?? null;
    }

    setCascadeDangerousDebrisId(dangerousDebris.id);
    setCascadeTargetSatId(nearestId);
    cascadeDangerousDebrisIdRef.current = dangerousDebris.id;
    cascadeTargetSatIdRef.current = nearestId;

    setKesslerDebris((prev) =>
      prev.map((d) => ({
        ...d,
        isDangerous: d.id === dangerousDebris.id,
      }))
    );
  }, [kesslerSimState, kesslerDebris.length, viewer, kesslerSatellitesWithProperties]);

  // Phase 5: secondary impact — remove colliding objects and spawn second debris cloud
  useEffect(() => {
    if (kesslerSimState !== 'cascade_impact' || cascadeImpactHandledRef.current) return;

    const dangerousId = cascadeDangerousDebrisIdRef.current;
    const dangerous = kesslerDebrisRef.current.find((d) => d.id === dangerousId);
    if (!dangerous) return;

    cascadeImpactHandledRef.current = true;

    const impactPos = getDebrisWorldPosition(dangerous);
    setSecondaryImpactPosition(Cesium.Cartesian3.clone(impactPos));
    secondaryImpactTimeRef.current = Date.now();

    const fragmentCount = 20 + Math.floor(Math.random() * 6);
    const newFragments = generateKesslerDebrisFragments(
      impactPos,
      fragmentCount,
      'kessler-debris-2'
    );

    setKesslerDebris((prev) => [
      ...prev.filter((d) => d.id !== dangerousId),
      ...newFragments,
    ]);
  }, [kesslerSimState]);

  // Phase 6: select three dangerous debris fragments and nearby target satellites
  useEffect(() => {
    if (kesslerSimState !== 'final_highlight' || finalCascadeSelectionDoneRef.current) return;
    if (kesslerDebris.length < 3 || !viewer) return;

    finalCascadeSelectionDoneRef.current = true;

    const shuffled = [...kesslerDebris].sort(() => Math.random() - 0.5);
    const selectedDebris = shuffled.slice(0, 3);
    const usedSatIds = new Set<string>();
    if (cascadeTargetSatIdRef.current) {
      usedSatIds.add(cascadeTargetSatIdRef.current);
    }

    const pairs: FinalCascadePair[] = [];

    for (const debris of selectedDebris) {
      const debrisPos = getDebrisWorldPosition(debris);
      let nearestId: string | null = null;
      let nearestDist = Infinity;

      for (const sat of kesslerSatellitesWithProperties) {
        if (sat.isFeatured || usedSatIds.has(sat.id)) continue;
        const time = viewer.clock.currentTime;
        const satPos = sat.positionProperty?.getValue?.(time);
        if (!satPos) continue;
        const dist = Cesium.Cartesian3.distance(debrisPos, satPos);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestId = sat.id;
        }
      }

      if (!nearestId) {
        const fallback = kesslerSatellitesWithProperties.find(
          (s) => !s.isFeatured && !usedSatIds.has(s.id)
        );
        nearestId = fallback?.id ?? null;
      }

      if (nearestId) {
        usedSatIds.add(nearestId);
        pairs.push({ debrisId: debris.id, satId: nearestId });
      }
    }

    setFinalCascadePairs(pairs);
    finalCascadePairsRef.current = pairs;

    setKesslerDebris((prev) =>
      prev.map((d) => ({
        ...d,
        isDangerous: pairs.some((p) => p.debrisId === d.id),
      }))
    );
  }, [kesslerSimState, kesslerDebris.length, viewer, kesslerSatellitesWithProperties]);

  // Phase 6: runaway collisions — three rapid impacts
  useEffect(() => {
    const impactIndex =
      kesslerSimState === 'final_impact_1'
        ? 0
        : kesslerSimState === 'final_impact_2'
        ? 1
        : kesslerSimState === 'final_impact_3'
        ? 2
        : -1;
    if (impactIndex < 0) return;
    if (finalImpactsHandledRef.current.has(impactIndex)) return;

    const pair = finalCascadePairsRef.current[impactIndex];
    if (!pair) return;

    const debris = kesslerDebrisRef.current.find((d) => d.id === pair.debrisId);
    if (!debris) return;

    finalImpactsHandledRef.current.add(impactIndex);

    const impactPos = getDebrisWorldPosition(debris);
    const impactTime = Date.now();

    setFinalImpactEffects((prev) => [
      ...prev,
      { position: Cesium.Cartesian3.clone(impactPos), time: impactTime },
    ]);

    const fragmentCounts = FINAL_DEBRIS_COUNTS;
    const newFragments = generateKesslerDebrisFragments(
      impactPos,
      fragmentCounts[impactIndex],
      `kessler-debris-final-${impactIndex + 1}`
    );

    setKesslerDebris((prev) => [
      ...prev.filter((d) => d.id !== pair.debrisId),
      ...newFragments,
    ]);
  }, [kesslerSimState]);

  useEffect(() => {
    if (typeof window === 'undefined' || !viewer) return;

    const list = [];
    // Aegis-7 (Collision Pair A)
    list.push({
      id: "kessler-feat-a",
      name: "Aegis-7",
      isFeatured: true,
      altitude: 680000, // 680 km (staggered slightly higher)
      latBase: 39.5, // staggered latitude
      inclination: 7.0, // slight tilt variation
      initialLon: -95.0, // starting position visible on the left-center
      speed: 1.0,
      phaseOffset: 0.0,
    });

    // Cosmos-2489 (Collision Pair B)
    list.push({
      id: "kessler-feat-b",
      name: "Cosmos-2489",
      isFeatured: true,
      altitude: 620000, // 620 km (staggered slightly lower)
      latBase: 36.5, // staggered latitude
      inclination: 9.0, // slight tilt variation
      initialLon: -65.0, // starting position visible on the right-center
      speed: 1.0,
      phaseOffset: Math.PI, // opposite phase in the path wave (tandem flight)
    });

    // Standard satellites: 18 total
    for (let i = 0; i < 18; i++) {
      // Vary altitudes between 350 km and 850 km
      const alt = 350000 + (i * 73000) % 500000;
      
      // Base latitudes distributed between 32° N and 52° N ( horizon band )
      const latBase = 32.0 + (i * 4.1) % 19.0;
      
      // Diagonal orbital tilts between 4° and 12°
      const inc = 4.0 + (i * 2.1) % 8.0;
      
      // Distribute starting longitudes across the full globe
      const initialLon = -180.0 + (i * 20.0);
      
      // Vary speed factor slightly (0.8x to 1.2x) for independent motion
      const speed = 0.8 + (i * 0.05) % 0.4;
      
      // Phase offsets for the sine wave wave-path
      const phaseOffset = (i * 45) * Math.PI / 180;

      list.push({
        id: `kessler-std-${i}`,
        name: `Sat-OS-${100 + i}`,
        isFeatured: false,
        altitude: alt,
        latBase: latBase,
        inclination: inc,
        initialLon: initialLon,
        speed: speed,
        phaseOffset: phaseOffset,
      });
    }

    const processed = list.map(sat => {
      // 1. Position Callback Property (slow continuous revolution around the horizon; featured satellites approach midpoint on simulation active)
      const positionProperty = new Cesium.CallbackProperty((time) => {
        if (!time || !viewer?.clock?.startTime) return new Cesium.Cartesian3();
        
        let seconds = Cesium.JulianDate.secondsDifference(time, viewer.clock.startTime);
        if (kesslerSimStateRef.current === 'frozen' && freezeSecondsRef.current !== null) {
          seconds = freezeSecondsRef.current;
        }

        // Standard satellites revolve normally (with cascade convergence for target satellite)
        if (!sat.isFeatured) {
          const lonAngle = sat.initialLon + seconds * sat.speed * baseSpeed;
          let lon = lonAngle % 360;
          if (lon > 180) lon -= 360;
          if (lon < -180) lon += 360;

          const lat = sat.latBase + sat.inclination * Math.sin(lonAngle * Math.PI / 180 + sat.phaseOffset);
          const carto = Cesium.Cartographic.fromDegrees(lon, lat, sat.altitude);
          const orbitalPos = Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto);

          const simState = kesslerSimStateRef.current;
          if (
            sat.id === cascadeTargetSatIdRef.current &&
            (simState === 'cascade_approach' || simState === 'cascade_impact')
          ) {
            const dangerous = kesslerDebrisRef.current.find(
              (d) => d.id === cascadeDangerousDebrisIdRef.current
            );
            if (dangerous) {
              const elapsed = Date.now() - kesslerSecondaryCollisionStartTimeRef.current;
              const debrisPos = getDebrisWorldPosition(dangerous);
              const progress = Math.min(elapsed / CASCADE_APPROACH_MS, 1);
              const pEased = progress * progress * (3 - 2 * progress);
              return Cesium.Cartesian3.lerp(orbitalPos, debrisPos, pEased, new Cesium.Cartesian3());
            }
          }

          const finalPair = finalCascadePairsRef.current.find((p) => p.satId === sat.id);
          if (finalPair && simState === 'final_approach') {
            const dangerous = kesslerDebrisRef.current.find((d) => d.id === finalPair.debrisId);
            if (dangerous) {
              const elapsed = Date.now() - kesslerFinalCollisionStartTimeRef.current;
              const debrisPos = getDebrisWorldPosition(dangerous);
              const progress = Math.min(elapsed / FINAL_APPROACH_MS, 1);
              const pEased = progress * progress * (3 - 2 * progress);
              return Cesium.Cartesian3.lerp(orbitalPos, debrisPos, pEased, new Cesium.Cartesian3());
            }
          }

          return orbitalPos;
        }

        // Featured satellites: calculate static start position
        const startCarto = Cesium.Cartographic.fromDegrees(sat.initialLon, sat.latBase, sat.altitude);
        const startPos = Cesium.Ellipsoid.WGS84.cartographicToCartesian(startCarto);

        // Precalculated midpoint coordinates
        const featACarto = Cesium.Cartographic.fromDegrees(-95.0, 39.5, 680000);
        const featAPos = Cesium.Ellipsoid.WGS84.cartographicToCartesian(featACarto);
        const featBCarto = Cesium.Cartographic.fromDegrees(-65.0, 36.5, 620000);
        const featBPos = Cesium.Ellipsoid.WGS84.cartographicToCartesian(featBCarto);
        const midpoint = Cesium.Cartesian3.multiplyByScalar(
          Cesium.Cartesian3.add(featAPos, featBPos, new Cesium.Cartesian3()),
          0.5,
          new Cesium.Cartesian3()
        );

        // Check if approaching
        if (kesslerSimStateRef.current === 'collision_sequence' || kesslerSimStateRef.current === 'impact' || kesslerSimStateRef.current === 'debris_drifting') {
          const elapsed = Date.now() - kesslerCollisionStartTimeRef.current;
          if (elapsed >= 2000) {
            return midpoint;
          } else if (elapsed >= 500) {
            const p = (elapsed - 500) / 1500;
            const pEased = p * p * (3 - 2 * p); // smoothstep easing
            return Cesium.Cartesian3.lerp(startPos, midpoint, pEased, new Cesium.Cartesian3());
          }
        }

        return startPos;
      }, false);

      // 2. Color/Alpha Callback Property (featured satellite amber pulse, standard white; intensifies glow as it approaches)
      const colorProperty = new Cesium.CallbackProperty(() => {
        if (sat.isFeatured) {
          const active = kesslerSimStateRef.current !== 'idle';
          const elapsed = Date.now() % (active ? 1000 : 2500);
          const progress = elapsed / (active ? 1000 : 2500);
          
          let pulseGlow = active 
            ? 0.55 + 0.45 * Math.sin(progress * Math.PI * 2)
            : 0.75 + 0.25 * Math.sin(progress * Math.PI * 2);

          // Intensify glow even further during the active convergence approach
          if (kesslerSimStateRef.current === 'collision_sequence') {
            const timeSinceStart = Date.now() - kesslerCollisionStartTimeRef.current;
            if (timeSinceStart >= 500 && timeSinceStart < 2000) {
              const approachProgress = (timeSinceStart - 500) / 1500;
              // Gradually push alpha to solid glowing orange-white as they near impact
              pulseGlow = pulseGlow * (1 - approachProgress) + 1.0 * approachProgress;
            } else if (timeSinceStart >= 2000) {
              pulseGlow = 1.0;
            }
          }

          const colorStr = active ? '#fbbf24' : '#f59e0b';
          return Cesium.Color.fromCssColorString(colorStr).withAlpha(pulseGlow);
        } else {
          if (
            sat.id === cascadeTargetSatIdRef.current &&
            kesslerSimStateRef.current === 'cascade_approach'
          ) {
            const elapsed = Date.now() % 1400;
            const progress = elapsed / 1400;
            const alpha = 0.85 + 0.15 * Math.sin(progress * Math.PI * 2);
            return Cesium.Color.fromCssColorString('#93c5fd').withAlpha(alpha);
          }

          const finalPairIndex = finalCascadePairsRef.current.findIndex((p) => p.satId === sat.id);
          const simState = kesslerSimStateRef.current;
          if (
            finalPairIndex >= 0 &&
            (simState === 'final_highlight' || simState === 'final_approach')
          ) {
            const isVisible =
              simState === 'final_approach' || finalPairIndex < finalHighlightStageRef.current;
            if (isVisible) {
              const elapsed = Date.now() % 1400;
              const progress = elapsed / 1400;
              const alpha = 0.85 + 0.15 * Math.sin(progress * Math.PI * 2);
              return Cesium.Color.fromCssColorString('#93c5fd').withAlpha(alpha);
            }
          }

          return Cesium.Color.WHITE.withAlpha(0.95);
        }
      }, false);

      // 3. Dynamic Scale (Featured satellites pulse at 25-30% larger size than standard; 10% larger during simulation active)
      let scaleProperty = undefined as any;
      if (sat.isFeatured) {
        scaleProperty = new Cesium.CallbackProperty(() => {
          const active = kesslerSimStateRef.current !== 'idle';
          const elapsed = Date.now() % (active ? 1000 : 2500);
          const progress = elapsed / (active ? 1000 : 2500);
          if (active) {
            return 1.05 + 0.12 * Math.sin(progress * Math.PI * 2); // average 1.11 (10% larger than baseline)
          } else {
            return 0.95 + 0.10 * Math.sin(progress * Math.PI * 2); // average 1.00
          }
        }, false);
      }

      return {
        ...sat,
        positionProperty,
        colorProperty,
        scaleProperty,
      };
    });

    setKesslerSatellitesWithProperties(processed);
  }, [viewer]);

  useEffect(() => {
    isISSFocusedRef.current = isISSFocused;
    if (!isISSFocused && issLabelRef.current) {
      issLabelRef.current.style.display = 'none';
    }
  }, [isISSFocused]);

  // Keep callback ref updated to prevent stale closures in Cesium event handlers
  const onSelectLocationRef = useRef(onSelectLocation);
  useEffect(() => {
    onSelectLocationRef.current = onSelectLocation;
    if (!onSelectLocation && viewer?.scene?.canvas) {
      viewer.scene.canvas.classList.remove('globe-hover-pointer');
    }
  }, [onSelectLocation, viewer]);

  // Lock camera interactions in Kessler Mode
  useEffect(() => {
    if (!viewer) return;
    const controller = viewer.scene.screenSpaceCameraController;
    const handler = viewer.screenSpaceEventHandler;
    if (isKessler) {
      controller.enableRotate = false;
      controller.enableTranslate = false;
      controller.enableZoom = false;
      controller.enableTilt = false;
      controller.enableLook = false;
      
      // Save original double click action if not already saved
      if (!originalDoubleClickRef.current) {
        originalDoubleClickRef.current = handler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      }
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    } else {
      controller.enableRotate = true;
      controller.enableTranslate = true;
      controller.enableZoom = true;
      controller.enableTilt = true;
      controller.enableLook = true;
      
      // Restore original double click action if we saved it
      if (originalDoubleClickRef.current) {
        handler.setInputAction(originalDoubleClickRef.current, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      }
    }
  }, [viewer, isKessler]);

  // Dynamic canvas images for premium tracking marker
  const [baseMarkerImage, setBaseMarkerImage] = useState<string>('');
  const [pulseMarkerImage, setPulseMarkerImage] = useState<string>('');
  const [issMarkerImage, setIssMarkerImage] = useState<string>('');
  const [tiangongMarkerImage, setTiangongMarkerImage] = useState<string>('');
  const [starlinkMarkerImage, setStarlinkMarkerImage] = useState<string>('');
  const [kesslerStandardSatImage, setKesslerStandardSatImage] = useState<string>('');
  const [kesslerFeaturedSatImage, setKesslerFeaturedSatImage] = useState<string>('');
  const [hubbleMarkerImage, setHubbleMarkerImage] = useState<string>('');
  const [landsatMarkerImage, setLandsatMarkerImage] = useState<string>('');
  const [rocketMarkerImage, setRocketMarkerImage] = useState<string>('');
  const [inactiveSatelliteMarkerImage, setInactiveSatelliteMarkerImage] = useState<string>('');
  const [featuredMarkerImage, setFeaturedMarkerImage] = useState<string>('');
  const [featuredPulseMarkerImage, setFeaturedPulseMarkerImage] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 1. Static base canvas targeting reticle
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = 128;
      baseCanvas.height = 128;
      const ctx = baseCanvas.getContext('2d');
      if (ctx) {
        const cx = 64;
        const cy = 64;

        // Soft outer glow (translucent radial gradient)
        const glowGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 46);
        glowGrad.addColorStop(0, 'rgba(5, 255, 195, 0.4)');
        glowGrad.addColorStop(0.5, 'rgba(5, 255, 195, 0.08)');
        glowGrad.addColorStop(1, 'rgba(5, 255, 195, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, 46, 0, Math.PI * 2);
        ctx.fill();

        // Thin circular tracking ring
        ctx.strokeStyle = 'rgba(5, 255, 195, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.stroke();

        // Small central white core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#05ffc3';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        setBaseMarkerImage(baseCanvas.toDataURL());
      }

      // 2. Pulse outer ring canvas
      const pulseCanvas = document.createElement('canvas');
      pulseCanvas.width = 128;
      pulseCanvas.height = 128;
      const pCtx = pulseCanvas.getContext('2d');
      if (pCtx) {
        const cx = 64;
        const cy = 64;

        pCtx.strokeStyle = 'rgba(5, 255, 195, 0.65)';
        pCtx.lineWidth = 1.2;
        pCtx.beginPath();
        pCtx.arc(cx, cy, 30, 0, Math.PI * 2);
        pCtx.stroke();

        setPulseMarkerImage(pulseCanvas.toDataURL());
      }

      // 3. Custom ISS visual marker (Satellite icon with panels and cyan glow)
      const issCanvas = document.createElement('canvas');
      issCanvas.width = 128;
      issCanvas.height = 128;
      const iCtx = issCanvas.getContext('2d');
      if (iCtx) {
        const cx = 64;
        const cy = 64;

        // Subtle outer purple glow
        const glowGrad = iCtx.createRadialGradient(cx, cy, 2, cx, cy, 32);
        glowGrad.addColorStop(0, 'rgba(192, 132, 252, 0.55)');
        glowGrad.addColorStop(0.4, 'rgba(192, 132, 252, 0.2)');
        glowGrad.addColorStop(1, 'rgba(192, 132, 252, 0)');
        iCtx.fillStyle = glowGrad;
        iCtx.beginPath();
        iCtx.arc(cx, cy, 32, 0, Math.PI * 2);
        iCtx.fill();

        // Central white core (ISS module)
        iCtx.fillStyle = '#ffffff';
        iCtx.beginPath();
        iCtx.arc(cx, cy, 5, 0, Math.PI * 2);
        iCtx.fill();
        iCtx.strokeStyle = '#c084fc';
        iCtx.lineWidth = 1.5;
        iCtx.stroke();

        // Main truss line (connecting panels)
        iCtx.strokeStyle = '#c084fc';
        iCtx.lineWidth = 2.0;
        iCtx.beginPath();
        iCtx.moveTo(cx - 24, cy);
        iCtx.lineTo(cx + 24, cy);
        iCtx.stroke();

        // Solar panels left
        iCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        iCtx.strokeStyle = '#c084fc';
        iCtx.lineWidth = 1.0;
        iCtx.fillRect(cx - 24, cy - 10, 8, 20);
        iCtx.strokeRect(cx - 24, cy - 10, 8, 20);

        // Solar panels right
        iCtx.fillRect(cx + 16, cy - 10, 8, 20);
        iCtx.strokeRect(cx + 16, cy - 10, 8, 20);

        // Radiators/antenna details
        iCtx.strokeStyle = '#c084fc';
        iCtx.lineWidth = 1.5;
        iCtx.beginPath();
        iCtx.moveTo(cx, cy - 12);
        iCtx.lineTo(cx, cy + 12);
        iCtx.stroke();

        setIssMarkerImage(issCanvas.toDataURL());
      }

      // 4. ISS Focus Base Image (purple targeting reticle)
      const issFocusBaseCanvas = document.createElement('canvas');
      issFocusBaseCanvas.width = 128;
      issFocusBaseCanvas.height = 128;
      const ifbCtx = issFocusBaseCanvas.getContext('2d');
      if (ifbCtx) {
        const cx = 64;
        const cy = 64;

        // Soft outer glow (translucent radial gradient)
        const glowGrad = ifbCtx.createRadialGradient(cx, cy, 4, cx, cy, 46);
        glowGrad.addColorStop(0, 'rgba(192, 132, 252, 0.4)');
        glowGrad.addColorStop(0.5, 'rgba(192, 132, 252, 0.08)');
        glowGrad.addColorStop(1, 'rgba(192, 132, 252, 0)');
        ifbCtx.fillStyle = glowGrad;
        ifbCtx.beginPath();
        ifbCtx.arc(cx, cy, 46, 0, Math.PI * 2);
        ifbCtx.fill();

        // Thin circular tracking ring
        ifbCtx.strokeStyle = 'rgba(192, 132, 252, 0.8)';
        ifbCtx.lineWidth = 1.2;
        ifbCtx.beginPath();
        ifbCtx.arc(cx, cy, 22, 0, Math.PI * 2);
        ifbCtx.stroke();

        // Small central white core
        ifbCtx.fillStyle = '#ffffff';
        ifbCtx.beginPath();
        ifbCtx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ifbCtx.fill();
        ifbCtx.strokeStyle = '#c084fc';
        ifbCtx.lineWidth = 1.5;
        ifbCtx.stroke();

        setIssFocusBaseImage(issFocusBaseCanvas.toDataURL());
      }

      // 5. ISS Focus Pulse Image (purple pulsing ring)
      const issFocusPulseCanvas = document.createElement('canvas');
      issFocusPulseCanvas.width = 128;
      issFocusPulseCanvas.height = 128;
      const ifpCtx = issFocusPulseCanvas.getContext('2d');
      if (ifpCtx) {
        const cx = 64;
        const cy = 64;

        ifpCtx.strokeStyle = 'rgba(192, 132, 252, 0.65)';
        ifpCtx.lineWidth = 1.2;
        ifpCtx.beginPath();
        ifpCtx.arc(cx, cy, 30, 0, Math.PI * 2);
        ifpCtx.stroke();

        setIssFocusPulseImage(issFocusPulseCanvas.toDataURL());
      }

      // 6. Tiangong Marker (T-shape Chinese Space Station with solar wings)
      const tiangongCanvas = document.createElement('canvas');
      tiangongCanvas.width = 128;
      tiangongCanvas.height = 128;
      const tCtx = tiangongCanvas.getContext('2d');
      if (tCtx) {
        const cx = 64;
        const cy = 64;

        // Subtle gold glow
        const glowGrad = tCtx.createRadialGradient(cx, cy, 2, cx, cy, 32);
        glowGrad.addColorStop(0, 'rgba(251, 191, 36, 0.55)');
        glowGrad.addColorStop(0.4, 'rgba(251, 191, 36, 0.2)');
        glowGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
        tCtx.fillStyle = glowGrad;
        tCtx.beginPath();
        tCtx.arc(cx, cy, 32, 0, Math.PI * 2);
        tCtx.fill();

        // Core module (central cylinder)
        tCtx.fillStyle = '#ffffff';
        tCtx.strokeStyle = '#fbbf24';
        tCtx.lineWidth = 1.5;
        tCtx.fillRect(cx - 4, cy - 14, 8, 28);
        tCtx.strokeRect(cx - 4, cy - 14, 8, 28);

        // Cross module (forming T-shape)
        tCtx.fillRect(cx - 12, cy - 4, 24, 8);
        tCtx.strokeRect(cx - 12, cy - 4, 24, 8);

        // Left massive solar array
        tCtx.fillStyle = 'rgba(56, 189, 248, 0.9)'; // Cyan solar panel cells
        tCtx.fillRect(cx - 28, cy - 6, 12, 12);
        tCtx.strokeRect(cx - 28, cy - 6, 12, 12);

        // Right massive solar array
        tCtx.fillRect(cx + 16, cy - 6, 12, 12);
        tCtx.strokeRect(cx + 16, cy - 6, 12, 12);

        setTiangongMarkerImage(tiangongCanvas.toDataURL());
      }

      // 7. Starlink Marker (Flat panel body with a single massive long solar panel wing)
      const starlinkCanvas = document.createElement('canvas');
      starlinkCanvas.width = 128;
      starlinkCanvas.height = 128;
      const sCtx = starlinkCanvas.getContext('2d');
      if (sCtx) {
        const cx = 64;
        const cy = 64;

        // Subtle blue-cyan glow
        const glowGrad = sCtx.createRadialGradient(cx, cy, 2, cx, cy, 28);
        glowGrad.addColorStop(0, 'rgba(34, 211, 238, 0.55)');
        glowGrad.addColorStop(0.4, 'rgba(34, 211, 238, 0.2)');
        glowGrad.addColorStop(1, 'rgba(34, 211, 238, 0)');
        sCtx.fillStyle = glowGrad;
        sCtx.beginPath();
        sCtx.arc(cx, cy, 28, 0, Math.PI * 2);
        sCtx.fill();

        // Starlink Flat Body (slanted rectangle)
        sCtx.fillStyle = '#ffffff';
        sCtx.strokeStyle = '#22d3ee';
        sCtx.lineWidth = 1.5;
        
        sCtx.beginPath();
        sCtx.moveTo(cx - 8, cy - 3);
        sCtx.lineTo(cx + 8, cy - 3);
        sCtx.lineTo(cx + 4, cy + 3);
        sCtx.lineTo(cx - 12, cy + 3);
        sCtx.closePath();
        sCtx.fill();
        sCtx.stroke();

        // Single long solar array extending upwards/sideways
        sCtx.fillStyle = 'rgba(56, 189, 248, 0.95)';
        sCtx.fillRect(cx - 4, cy - 24, 8, 18);
        sCtx.strokeRect(cx - 4, cy - 24, 8, 18);

        // Divider lines on solar panel
        sCtx.strokeStyle = '#22d3ee';
        sCtx.lineWidth = 1;
        sCtx.beginPath();
        sCtx.moveTo(cx - 4, cy - 15);
        sCtx.lineTo(cx + 4, cy - 15);
        sCtx.moveTo(cx - 4, cy - 9);
        sCtx.lineTo(cx + 4, cy - 9);
        sCtx.stroke();

        setStarlinkMarkerImage(starlinkCanvas.toDataURL());
      }

      // 8. Hubble Marker (Cylindrical tube telescope body with two side wing panels)
      const hubbleCanvas = document.createElement('canvas');
      hubbleCanvas.width = 128;
      hubbleCanvas.height = 128;
      const hCtx = hubbleCanvas.getContext('2d');
      if (hCtx) {
        const cx = 64;
        const cy = 64;

        // Subtle silver/white glow
        const glowGrad = hCtx.createRadialGradient(cx, cy, 2, cx, cy, 32);
        glowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
        glowGrad.addColorStop(0.4, 'rgba(255, 255, 255, 0.15)');
        glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        hCtx.fillStyle = glowGrad;
        hCtx.beginPath();
        hCtx.arc(cx, cy, 32, 0, Math.PI * 2);
        hCtx.fill();

        // Main cylindrical tube body (slanted for cinematic 3D perspective)
        hCtx.fillStyle = '#e2e8f0';
        hCtx.strokeStyle = '#94a3b8';
        hCtx.lineWidth = 1.5;
        
        // Telescope tube
        hCtx.beginPath();
        hCtx.arc(cx, cy, 8, 0, Math.PI * 2);
        hCtx.fill();
        hCtx.stroke();

        // Main cylinder extension
        hCtx.fillStyle = '#cbd5e1';
        hCtx.fillRect(cx - 8, cy - 18, 16, 18);
        hCtx.strokeRect(cx - 8, cy - 18, 16, 18);

        // Open aperture door at the top
        hCtx.strokeStyle = '#94a3b8';
        hCtx.beginPath();
        hCtx.moveTo(cx - 8, cy - 18);
        hCtx.quadraticCurveTo(cx - 14, cy - 24, cx - 6, cy - 26);
        hCtx.stroke();

        // Left solar panel wing
        hCtx.fillStyle = 'rgba(56, 189, 248, 0.9)';
        hCtx.fillRect(cx - 24, cy - 12, 12, 6);
        hCtx.strokeRect(cx - 24, cy - 12, 12, 6);

        // Right solar panel wing
        hCtx.fillRect(cx + 12, cy - 12, 12, 6);
        hCtx.strokeRect(cx + 12, cy - 12, 12, 6);

        setHubbleMarkerImage(hubbleCanvas.toDataURL());
      }

      // 9. Landsat Marker (Central sensor box with dual large solar panels on left/right)
      const landsatCanvas = document.createElement('canvas');
      landsatCanvas.width = 128;
      landsatCanvas.height = 128;
      const lCtx = landsatCanvas.getContext('2d');
      if (lCtx) {
        const cx = 64;
        const cy = 64;

        // Subtle emerald green glow
        const glowGrad = lCtx.createRadialGradient(cx, cy, 2, cx, cy, 32);
        glowGrad.addColorStop(0, 'rgba(16, 185, 129, 0.55)');
        glowGrad.addColorStop(0.4, 'rgba(16, 185, 129, 0.2)');
        glowGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        lCtx.fillStyle = glowGrad;
        lCtx.beginPath();
        lCtx.arc(cx, cy, 32, 0, Math.PI * 2);
        lCtx.fill();

        // Central sensor module (white octagonal/hexagonal core)
        lCtx.fillStyle = '#ffffff';
        lCtx.strokeStyle = '#10b981';
        lCtx.lineWidth = 1.5;
        lCtx.beginPath();
        lCtx.moveTo(cx - 7, cy - 10);
        lCtx.lineTo(cx + 7, cy - 10);
        lCtx.lineTo(cx + 10, cy);
        lCtx.lineTo(cx + 7, cy + 10);
        lCtx.lineTo(cx - 7, cy + 10);
        lCtx.lineTo(cx - 10, cy);
        lCtx.closePath();
        lCtx.fill();
        lCtx.stroke();

        // Sensor aperture center detail
        lCtx.fillStyle = '#10b981';
        lCtx.beginPath();
        lCtx.arc(cx, cy, 3, 0, Math.PI * 2);
        lCtx.fill();

        // Solar panel arms
        lCtx.strokeStyle = '#10b981';
        lCtx.lineWidth = 2.0;
        lCtx.beginPath();
        lCtx.moveTo(cx - 24, cy);
        lCtx.lineTo(cx - 10, cy);
        lCtx.moveTo(cx + 10, cy);
        lCtx.lineTo(cx + 24, cy);
        lCtx.stroke();

        // Left solar wing
        lCtx.fillStyle = 'rgba(56, 189, 248, 0.95)';
        lCtx.fillRect(cx - 24, cy - 8, 12, 16);
        lCtx.strokeRect(cx - 24, cy - 8, 12, 16);

        // Right solar wing
        lCtx.fillRect(cx + 12, cy - 8, 12, 16);
        lCtx.strokeRect(cx + 12, cy - 8, 12, 16);

        setLandsatMarkerImage(landsatCanvas.toDataURL());
      }

      // 10. Rocket Body Marker (stylized orange rocket icon)
      const rocketCanvas = document.createElement('canvas');
      rocketCanvas.width = 64;
      rocketCanvas.height = 64;
      const rBodyCtx = rocketCanvas.getContext('2d');
      if (rBodyCtx) {
        const cx = 32;
        const cy = 32;

        // Orange glow
        const glowGrad = rBodyCtx.createRadialGradient(cx, cy, 2, cx, cy, 20);
        glowGrad.addColorStop(0, 'rgba(249, 115, 22, 0.6)');
        glowGrad.addColorStop(0.5, 'rgba(249, 115, 22, 0.15)');
        glowGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        rBodyCtx.fillStyle = glowGrad;
        rBodyCtx.beginPath();
        rBodyCtx.arc(cx, cy, 20, 0, Math.PI * 2);
        rBodyCtx.fill();

        // Stylized Rocket Shape (pointing straight up)
        rBodyCtx.fillStyle = '#f97316';
        rBodyCtx.strokeStyle = '#ea580c';
        rBodyCtx.lineWidth = 1.5;

        // Body
        rBodyCtx.beginPath();
        rBodyCtx.moveTo(cx, cy - 12); // nose cone tip
        rBodyCtx.bezierCurveTo(cx + 5, cy - 4, cx + 5, cy + 6, cx + 4, cy + 8); // right side
        rBodyCtx.lineTo(cx - 4, cy + 8); // bottom
        rBodyCtx.bezierCurveTo(cx - 5, cy + 6, cx - 5, cy - 4, cx, cy - 12); // left side
        rBodyCtx.fill();
        rBodyCtx.stroke();

        // Left Fin
        rBodyCtx.fillStyle = '#ea580c';
        rBodyCtx.beginPath();
        rBodyCtx.moveTo(cx - 4, cy + 2);
        rBodyCtx.lineTo(cx - 9, cy + 9);
        rBodyCtx.lineTo(cx - 4, cy + 8);
        rBodyCtx.closePath();
        rBodyCtx.fill();

        // Right Fin
        rBodyCtx.beginPath();
        rBodyCtx.moveTo(cx + 4, cy + 2);
        rBodyCtx.lineTo(cx + 9, cy + 9);
        rBodyCtx.lineTo(cx + 4, cy + 8);
        rBodyCtx.closePath();
        rBodyCtx.fill();

        // Flame / exhaust glow
        rBodyCtx.fillStyle = '#fdba74';
        rBodyCtx.beginPath();
        rBodyCtx.moveTo(cx - 2, cy + 8);
        rBodyCtx.lineTo(cx, cy + 13);
        rBodyCtx.lineTo(cx + 2, cy + 8);
        rBodyCtx.closePath();
        rBodyCtx.fill();

        setRocketMarkerImage(rocketCanvas.toDataURL());
      }

      // 11. Inactive Satellite Marker (stylized slate gray satellite icon)
      const satelliteCanvas = document.createElement('canvas');
      satelliteCanvas.width = 64;
      satelliteCanvas.height = 64;
      const sBodyCtx = satelliteCanvas.getContext('2d');
      if (sBodyCtx) {
        const cx = 32;
        const cy = 32;

        // Gray glow
        const glowGrad = sBodyCtx.createRadialGradient(cx, cy, 2, cx, cy, 24);
        glowGrad.addColorStop(0, 'rgba(148, 163, 184, 0.55)');
        glowGrad.addColorStop(0.5, 'rgba(148, 163, 184, 0.15)');
        glowGrad.addColorStop(1, 'rgba(148, 163, 184, 0)');
        sBodyCtx.fillStyle = glowGrad;
        sBodyCtx.beginPath();
        sBodyCtx.arc(cx, cy, 24, 0, Math.PI * 2);
        sBodyCtx.fill();

        // Stylized Satellite Shape
        // Central body (circle)
        sBodyCtx.fillStyle = '#ffffff';
        sBodyCtx.strokeStyle = '#94a3b8';
        sBodyCtx.lineWidth = 1.5;
        sBodyCtx.beginPath();
        sBodyCtx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        sBodyCtx.fill();
        sBodyCtx.stroke();

        // Solar panels (left and right rectangles)
        sBodyCtx.fillStyle = '#64748b';
        sBodyCtx.strokeStyle = '#94a3b8';
        sBodyCtx.lineWidth = 1;
        
        // Left panel
        sBodyCtx.fillRect(cx - 16, cy - 3, 10, 6);
        sBodyCtx.strokeRect(cx - 16, cy - 3, 10, 6);

        // Right panel
        sBodyCtx.fillRect(cx + 6, cy - 3, 10, 6);
        sBodyCtx.strokeRect(cx + 6, cy - 3, 10, 6);

        // Connection bars
        sBodyCtx.strokeStyle = '#94a3b8';
        sBodyCtx.lineWidth = 1.2;
        sBodyCtx.beginPath();
        sBodyCtx.moveTo(cx - 6, cy);
        sBodyCtx.lineTo(cx + 6, cy);
        sBodyCtx.stroke();

        // Small antenna pointing down
        sBodyCtx.beginPath();
        sBodyCtx.moveTo(cx, cy + 4.5);
        sBodyCtx.lineTo(cx, cy + 8);
        sBodyCtx.stroke();
        sBodyCtx.fillStyle = '#94a3b8';
        sBodyCtx.beginPath();
        sBodyCtx.arc(cx, cy + 8, 1, 0, Math.PI * 2);
        sBodyCtx.fill();

        setInactiveSatelliteMarkerImage(satelliteCanvas.toDataURL());
      }

      // 12. Featured Object Marker (gold/amber glowing reticle)
      const featuredCanvas = document.createElement('canvas');
      featuredCanvas.width = 128;
      featuredCanvas.height = 128;
      const fCtx = featuredCanvas.getContext('2d');
      if (fCtx) {
        const cx = 64;
        const cy = 64;

        // Rich gold radial glow
        const glowGrad = fCtx.createRadialGradient(cx, cy, 4, cx, cy, 48);
        glowGrad.addColorStop(0, 'rgba(245, 158, 11, 0.65)');
        glowGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.18)');
        glowGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
        fCtx.fillStyle = glowGrad;
        fCtx.beginPath();
        fCtx.arc(cx, cy, 48, 0, Math.PI * 2);
        fCtx.fill();

        // Golden outer ring
        fCtx.strokeStyle = 'rgba(245, 158, 11, 0.95)';
        fCtx.lineWidth = 2.0;
        fCtx.beginPath();
        fCtx.arc(cx, cy, 18, 0, Math.PI * 2);
        fCtx.stroke();

        // Four tick marks
        fCtx.lineWidth = 2.5;
        fCtx.beginPath();
        fCtx.moveTo(cx - 24, cy); fCtx.lineTo(cx - 14, cy);
        fCtx.moveTo(cx + 14, cy); fCtx.lineTo(cx + 24, cy);
        fCtx.moveTo(cx, cy - 24); fCtx.lineTo(cx, cy - 14);
        fCtx.moveTo(cx, cy + 14); fCtx.lineTo(cx, cy + 24);
        fCtx.stroke();

        // White core with golden border
        fCtx.fillStyle = '#ffffff';
        fCtx.beginPath();
        fCtx.arc(cx, cy, 6, 0, Math.PI * 2);
        fCtx.fill();
        fCtx.strokeStyle = '#f59e0b';
        fCtx.lineWidth = 1.5;
        fCtx.stroke();

        setFeaturedMarkerImage(featuredCanvas.toDataURL());

        // 13. Featured Object Pulse Ring (gold/amber fading ring)
        const featuredPulseCanvas = document.createElement('canvas');
        featuredPulseCanvas.width = 128;
        featuredPulseCanvas.height = 128;
        const fpCtx = featuredPulseCanvas.getContext('2d');
        if (fpCtx) {
          const cx = 64;
          const cy = 64;
          fpCtx.strokeStyle = 'rgba(245, 158, 11, 0.95)';
          fpCtx.lineWidth = 2.0;
          fpCtx.beginPath();
          fpCtx.arc(cx, cy, 32, 0, Math.PI * 2);
          fpCtx.stroke();
          setFeaturedPulseMarkerImage(featuredPulseCanvas.toDataURL());
        }

        // 14. Kessler Standard Satellite Canvas (soft white/light-gray body and wings with glow)
        const kesslerStdCanvas = document.createElement('canvas');
        kesslerStdCanvas.width = 64;
        kesslerStdCanvas.height = 64;
        const kStdCtx = kesslerStdCanvas.getContext('2d');
        if (kStdCtx) {
          const cx = 32;
          const cy = 32;

          // Soft white glow
          const glowGrad = kStdCtx.createRadialGradient(cx, cy, 2, cx, cy, 16);
          glowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
          glowGrad.addColorStop(0.5, 'rgba(240, 243, 248, 0.15)');
          glowGrad.addColorStop(1, 'rgba(240, 243, 248, 0)');
          kStdCtx.fillStyle = glowGrad;
          kStdCtx.beginPath();
          kStdCtx.arc(cx, cy, 16, 0, Math.PI * 2);
          kStdCtx.fill();

          // Main body (circle)
          kStdCtx.fillStyle = '#ffffff';
          kStdCtx.strokeStyle = '#cbd5e1';
          kStdCtx.lineWidth = 1.2;
          kStdCtx.beginPath();
          kStdCtx.arc(cx, cy, 3.5, 0, Math.PI * 2);
          kStdCtx.fill();
          kStdCtx.stroke();

          // Solar panels left and right
          kStdCtx.fillStyle = '#94a3b8';
          kStdCtx.strokeStyle = '#cbd5e1';
          kStdCtx.lineWidth = 0.8;
          kStdCtx.fillRect(cx - 13, cy - 2, 8, 4);
          kStdCtx.strokeRect(cx - 13, cy - 2, 8, 4);
          kStdCtx.fillRect(cx + 5, cy - 2, 8, 4);
          kStdCtx.strokeRect(cx + 5, cy - 2, 8, 4);

          // Connection bar
          kStdCtx.strokeStyle = '#cbd5e1';
          kStdCtx.lineWidth = 1;
          kStdCtx.beginPath();
          kStdCtx.moveTo(cx - 5, cy);
          kStdCtx.lineTo(cx + 5, cy);
          kStdCtx.stroke();

          setKesslerStandardSatImage(kesslerStdCanvas.toDataURL());
        }

        // 15. Kessler Featured Satellite Canvas (soft golden/amber body and wings with glow)
        const kesslerFeatCanvas = document.createElement('canvas');
        kesslerFeatCanvas.width = 64;
        kesslerFeatCanvas.height = 64;
        const kFeatCtx = kesslerFeatCanvas.getContext('2d');
        if (kFeatCtx) {
          const cx = 32;
          const cy = 32;

          // Golden glow
          const glowGrad = kFeatCtx.createRadialGradient(cx, cy, 2, cx, cy, 20);
          glowGrad.addColorStop(0, 'rgba(245, 158, 11, 0.55)');
          glowGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.18)');
          glowGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
          kFeatCtx.fillStyle = glowGrad;
          kFeatCtx.beginPath();
          kFeatCtx.arc(cx, cy, 20, 0, Math.PI * 2);
          kFeatCtx.fill();

          // Main body (circle)
          kFeatCtx.fillStyle = '#ffffff';
          kFeatCtx.strokeStyle = '#f59e0b';
          kFeatCtx.lineWidth = 1.5;
          kFeatCtx.beginPath();
          kFeatCtx.arc(cx, cy, 4.2, 0, Math.PI * 2);
          kFeatCtx.fill();
          kFeatCtx.stroke();

          // Solar panels left and right
          kFeatCtx.fillStyle = '#d97706';
          kFeatCtx.strokeStyle = '#f59e0b';
          kFeatCtx.lineWidth = 1.0;
          kFeatCtx.fillRect(cx - 15, cy - 3, 9, 6);
          kFeatCtx.strokeRect(cx - 15, cy - 3, 9, 6);
          kFeatCtx.fillRect(cx + 6, cy - 3, 9, 6);
          kFeatCtx.strokeRect(cx + 6, cy - 3, 9, 6);

          // Connection bar
          kFeatCtx.strokeStyle = '#f59e0b';
          kFeatCtx.lineWidth = 1.2;
          kFeatCtx.beginPath();
          kFeatCtx.moveTo(cx - 6, cy);
          kFeatCtx.lineTo(cx + 6, cy);
          kFeatCtx.stroke();

          setKesslerFeaturedSatImage(kesslerFeatCanvas.toDataURL());
        }
      }
    }
  }, []);

  // Native Cesium properties for smooth animation loop (avoiding React state re-renders)
  const baseScaleRef = useRef<Cesium.CallbackProperty | null>(null);
  const baseColorRef = useRef<Cesium.CallbackProperty | null>(null);
  const pulseScaleRef = useRef<Cesium.CallbackProperty | null>(null);
  const pulseColorRef = useRef<Cesium.CallbackProperty | null>(null);

  // Featured Objects pulsing properties
  const featuredScaleRef = useRef<Cesium.CallbackProperty | null>(null);
  const featuredColorRef = useRef<Cesium.CallbackProperty | null>(null);
  const featuredPulseScaleRef = useRef<Cesium.CallbackProperty | null>(null);
  const featuredPulseColorRef = useRef<Cesium.CallbackProperty | null>(null);

  // Spacecraft Marker Properties
  const issTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const issPositionProperty = useRef<Cesium.CallbackProperty | null>(null);
  const issScaleRef = useRef<Cesium.CallbackProperty | null>(null);
  const issColorRef = useRef<Cesium.CallbackProperty | null>(null);

  const hubbleTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const hubblePositionProperty = useRef<Cesium.CallbackProperty | null>(null);
  const hubbleScaleRef = useRef<Cesium.CallbackProperty | null>(null);

  const tiangongTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const tiangongPositionProperty = useRef<Cesium.CallbackProperty | null>(null);
  const tiangongScaleRef = useRef<Cesium.CallbackProperty | null>(null);

  const starlinkTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const starlinkPositionProperty = useRef<Cesium.CallbackProperty | null>(null);
  const starlinkScaleRef = useRef<Cesium.CallbackProperty | null>(null);

  const landsatTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const landsatPositionProperty = useRef<Cesium.CallbackProperty | null>(null);
  const landsatScaleRef = useRef<Cesium.CallbackProperty | null>(null);

  // Unified Focus position properties
  const focusBasePositionProperty = useRef<Cesium.CallbackProperty | null>(null);
  const focusPulsePositionProperty = useRef<Cesium.CallbackProperty | null>(null);
  const issFocusPulseScaleRef = useRef<Cesium.CallbackProperty | null>(null);
  const issFocusPulseColorRef = useRef<Cesium.CallbackProperty | null>(null);

  // Sync latest hook telemetry values to refs
  const issData = spacecrafts.find((s) => s.id === "iss");
  const hubbleData = spacecrafts.find((s) => s.id === "hubble");
  const tiangongData = spacecrafts.find((s) => s.id === "tiangong");
  const starlinkData = spacecrafts.find((s) => s.id === "starlink");
  const landsatData = spacecrafts.find((s) => s.id === "landsat");

  useEffect(() => {
    if (issData && issData.latitude !== null && issData.longitude !== null) {
      issTargetRef.current = { lat: issData.latitude, lng: issData.longitude };
    }
  }, [issData?.latitude, issData?.longitude]);

  useEffect(() => {
    if (hubbleData && hubbleData.latitude !== null && hubbleData.longitude !== null) {
      hubbleTargetRef.current = { lat: hubbleData.latitude, lng: hubbleData.longitude };
    }
  }, [hubbleData?.latitude, hubbleData?.longitude]);

  useEffect(() => {
    if (tiangongData && tiangongData.latitude !== null && tiangongData.longitude !== null) {
      tiangongTargetRef.current = { lat: tiangongData.latitude, lng: tiangongData.longitude };
    }
  }, [tiangongData?.latitude, tiangongData?.longitude]);

  useEffect(() => {
    if (starlinkData && starlinkData.latitude !== null && starlinkData.longitude !== null) {
      starlinkTargetRef.current = { lat: starlinkData.latitude, lng: starlinkData.longitude };
    }
  }, [starlinkData?.latitude, starlinkData?.longitude]);

  useEffect(() => {
    if (landsatData && landsatData.latitude !== null && landsatData.longitude !== null) {
      landsatTargetRef.current = { lat: landsatData.latitude, lng: landsatData.longitude };
    }
  }, [landsatData?.latitude, landsatData?.longitude]);

  if (!baseScaleRef.current && typeof window !== 'undefined') {
    baseScaleRef.current = new Cesium.CallbackProperty(() => {
      const t = (Date.now() % 3000) / 3000 * Math.PI * 2;
      return 1.0 + 0.04 * Math.sin(t);
    }, false);

    baseColorRef.current = new Cesium.CallbackProperty(() => {
      const t = (Date.now() % 3000) / 3000 * Math.PI * 2;
      const alpha = 0.85 + 0.15 * Math.sin(t);
      return Cesium.Color.WHITE.withAlpha(alpha);
    }, false);

    pulseScaleRef.current = new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 2500;
      const progress = elapsed / 2500;
      return 0.7 + progress * 1.1;
    }, false);

    pulseColorRef.current = new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 2500;
      const progress = elapsed / 2500;
      const alpha = 0.85 * (1.0 - progress);
      return Cesium.Color.WHITE.withAlpha(alpha);
    }, false);
  }

  if (!featuredScaleRef.current && typeof window !== 'undefined') {
    featuredScaleRef.current = new Cesium.CallbackProperty(() => {
      const t = (Date.now() % 4000) / 4000 * Math.PI * 2;
      return 1.0 + 0.12 * Math.sin(t);
    }, false);

    featuredColorRef.current = new Cesium.CallbackProperty(() => {
      const t = (Date.now() % 4000) / 4000 * Math.PI * 2;
      const alpha = 0.8 + 0.2 * Math.sin(t);
      return Cesium.Color.WHITE.withAlpha(alpha);
    }, false);

    featuredPulseScaleRef.current = new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 2500;
      const progress = elapsed / 2500;
      return 0.6 + progress * 1.3;
    }, false);

    featuredPulseColorRef.current = new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 2500;
      const progress = elapsed / 2500;
      const alpha = 0.9 * (1.0 - progress);
      return Cesium.Color.WHITE.withAlpha(alpha);
    }, false);
  }

  if (!issPositionProperty.current && typeof window !== 'undefined') {
    let issCurrentLat = 0;
    let issCurrentLng = 0;
    let issInitialized = false;

    issPositionProperty.current = new Cesium.CallbackProperty(() => {
      if (!issTargetRef.current) return undefined as any;
      const target = issTargetRef.current;
      if (!issInitialized) {
        issCurrentLat = target.lat;
        issCurrentLng = target.lng;
        issInitialized = true;
      } else {
        issCurrentLat += (target.lat - issCurrentLat) * 0.03;
        let diffLng = target.lng - issCurrentLng;
        if (diffLng > 180) diffLng -= 360;
        if (diffLng < -180) diffLng += 360;
        issCurrentLng += diffLng * 0.03;
        if (issCurrentLng > 180) issCurrentLng -= 360;
        if (issCurrentLng < -180) issCurrentLng += 360;
      }
      return Cesium.Cartesian3.fromDegrees(issCurrentLng, issCurrentLat, 420000);
    }, false);

    let hubbleCurrentLat = 0;
    let hubbleCurrentLng = 0;
    let hubbleInitialized = false;

    hubblePositionProperty.current = new Cesium.CallbackProperty(() => {
      if (!hubbleTargetRef.current) return undefined as any;
      const target = hubbleTargetRef.current;
      if (!hubbleInitialized) {
        hubbleCurrentLat = target.lat;
        hubbleCurrentLng = target.lng;
        hubbleInitialized = true;
      } else {
        hubbleCurrentLat += (target.lat - hubbleCurrentLat) * 0.03;
        let diffLng = target.lng - hubbleCurrentLng;
        if (diffLng > 180) diffLng -= 360;
        if (diffLng < -180) diffLng += 360;
        hubbleCurrentLng += diffLng * 0.03;
        if (hubbleCurrentLng > 180) hubbleCurrentLng -= 360;
        if (hubbleCurrentLng < -180) hubbleCurrentLng += 360;
      }
      return Cesium.Cartesian3.fromDegrees(hubbleCurrentLng, hubbleCurrentLat, 540000);
    }, false);

    let tiangongCurrentLat = 0;
    let tiangongCurrentLng = 0;
    let tiangongInitialized = false;

    tiangongPositionProperty.current = new Cesium.CallbackProperty(() => {
      if (!tiangongTargetRef.current) return undefined as any;
      const target = tiangongTargetRef.current;
      if (!tiangongInitialized) {
        tiangongCurrentLat = target.lat;
        tiangongCurrentLng = target.lng;
        tiangongInitialized = true;
      } else {
        tiangongCurrentLat += (target.lat - tiangongCurrentLat) * 0.03;
        let diffLng = target.lng - tiangongCurrentLng;
        if (diffLng > 180) diffLng -= 360;
        if (diffLng < -180) diffLng += 360;
        tiangongCurrentLng += diffLng * 0.03;
        if (tiangongCurrentLng > 180) tiangongCurrentLng -= 360;
        if (tiangongCurrentLng < -180) tiangongCurrentLng += 360;
      }
      return Cesium.Cartesian3.fromDegrees(tiangongCurrentLng, tiangongCurrentLat, 390000);
    }, false);

    let starlinkCurrentLat = 0;
    let starlinkCurrentLng = 0;
    let starlinkInitialized = false;

    starlinkPositionProperty.current = new Cesium.CallbackProperty(() => {
      if (!starlinkTargetRef.current) return undefined as any;
      const target = starlinkTargetRef.current;
      if (!starlinkInitialized) {
        starlinkCurrentLat = target.lat;
        starlinkCurrentLng = target.lng;
        starlinkInitialized = true;
      } else {
        starlinkCurrentLat += (target.lat - starlinkCurrentLat) * 0.03;
        let diffLng = target.lng - starlinkCurrentLng;
        if (diffLng > 180) diffLng -= 360;
        if (diffLng < -180) diffLng += 360;
        starlinkCurrentLng += diffLng * 0.03;
        if (starlinkCurrentLng > 180) starlinkCurrentLng -= 360;
        if (starlinkCurrentLng < -180) starlinkCurrentLng += 360;
      }
      return Cesium.Cartesian3.fromDegrees(starlinkCurrentLng, starlinkCurrentLat, 550000);
    }, false);

    let landsatCurrentLat = 0;
    let landsatCurrentLng = 0;
    let landsatInitialized = false;

    landsatPositionProperty.current = new Cesium.CallbackProperty(() => {
      if (!landsatTargetRef.current) return undefined as any;
      const target = landsatTargetRef.current;
      if (!landsatInitialized) {
        landsatCurrentLat = target.lat;
        landsatCurrentLng = target.lng;
        landsatInitialized = true;
      } else {
        landsatCurrentLat += (target.lat - landsatCurrentLat) * 0.03;
        let diffLng = target.lng - landsatCurrentLng;
        if (diffLng > 180) diffLng -= 360;
        if (diffLng < -180) diffLng += 360;
        landsatCurrentLng += diffLng * 0.03;
        if (landsatCurrentLng > 180) landsatCurrentLng -= 360;
        if (landsatCurrentLng < -180) landsatCurrentLng += 360;
      }
      return Cesium.Cartesian3.fromDegrees(landsatCurrentLng, landsatCurrentLat, 705000);
    }, false);

    focusBasePositionProperty.current = new Cesium.CallbackProperty(() => {
      const activeId = selectedSpacecraftIdRef.current;
      if (activeId === "iss" && issTargetRef.current) {
        const cart = issPositionProperty.current?.getValue(new Cesium.JulianDate());
        if (cart) {
          const carto = Cesium.Cartographic.fromCartesian(cart);
          return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height - 200);
        }
      } else if (activeId === "hubble" && hubbleTargetRef.current) {
        const cart = hubblePositionProperty.current?.getValue(new Cesium.JulianDate());
        if (cart) {
          const carto = Cesium.Cartographic.fromCartesian(cart);
          return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height - 200);
        }
      } else if (activeId === "tiangong" && tiangongTargetRef.current) {
        const cart = tiangongPositionProperty.current?.getValue(new Cesium.JulianDate());
        if (cart) {
          const carto = Cesium.Cartographic.fromCartesian(cart);
          return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height - 200);
        }
      } else if (activeId === "starlink" && starlinkTargetRef.current) {
        const cart = starlinkPositionProperty.current?.getValue(new Cesium.JulianDate());
        if (cart) {
          const carto = Cesium.Cartographic.fromCartesian(cart);
          return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height - 200);
        }
      } else if (activeId === "landsat" && landsatTargetRef.current) {
        const cart = landsatPositionProperty.current?.getValue(new Cesium.JulianDate());
        if (cart) {
          const carto = Cesium.Cartographic.fromCartesian(cart);
          return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height - 200);
        }
      }
      return undefined as any;
    }, false);

    focusPulsePositionProperty.current = new Cesium.CallbackProperty(() => {
      const cart = focusBasePositionProperty.current?.getValue(new Cesium.JulianDate());
      if (cart) {
        const carto = Cesium.Cartographic.fromCartesian(cart);
        return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height + 100);
      }
      return undefined as any;
    }, false);

    issScaleRef.current = new Cesium.CallbackProperty(() => {
      if (selectedSpacecraftIdRef.current === 'iss' && isISSFocusedRef.current) {
        return 1.05;
      }
      const t = (Date.now() % 4000) / 4000 * Math.PI * 2;
      return 0.75 + 0.05 * Math.sin(t);
    }, false);

    hubbleScaleRef.current = new Cesium.CallbackProperty(() => {
      if (selectedSpacecraftIdRef.current === 'hubble' && isISSFocusedRef.current) {
        return 1.05;
      }
      const t = (Date.now() % 4000) / 4000 * Math.PI * 2;
      return 0.75 + 0.05 * Math.sin(t);
    }, false);

    tiangongScaleRef.current = new Cesium.CallbackProperty(() => {
      if (selectedSpacecraftIdRef.current === 'tiangong' && isISSFocusedRef.current) {
        return 1.05;
      }
      const t = (Date.now() % 4000) / 4000 * Math.PI * 2;
      return 0.75 + 0.05 * Math.sin(t);
    }, false);

    starlinkScaleRef.current = new Cesium.CallbackProperty(() => {
      if (selectedSpacecraftIdRef.current === 'starlink' && isISSFocusedRef.current) {
        return 1.05;
      }
      const t = (Date.now() % 4000) / 4000 * Math.PI * 2;
      return 0.75 + 0.05 * Math.sin(t);
    }, false);

    landsatScaleRef.current = new Cesium.CallbackProperty(() => {
      if (selectedSpacecraftIdRef.current === 'landsat' && isISSFocusedRef.current) {
        return 1.05;
      }
      const t = (Date.now() % 4000) / 4000 * Math.PI * 2;
      return 0.75 + 0.05 * Math.sin(t);
    }, false);

    issColorRef.current = new Cesium.CallbackProperty(() => {
      const t = (Date.now() % 4000) / 4000 * Math.PI * 2;
      const alpha = 0.85 + 0.15 * Math.sin(t);
      return Cesium.Color.WHITE.withAlpha(alpha);
    }, false);

    issFocusPulseScaleRef.current = new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 1500;
      const progress = elapsed / 1500;
      return 0.5 + progress * 1.5;
    }, false);

    issFocusPulseColorRef.current = new Cesium.CallbackProperty(() => {
      const elapsed = Date.now() % 1500;
      const progress = elapsed / 1500;
      const alpha = 0.8 * (1.0 - progress);
      const colorStr = selectedSpacecraftIdRef.current === 'tiangong' 
        ? '#fbbf24' 
        : selectedSpacecraftIdRef.current === 'hubble'
        ? '#38bdf8'
        : selectedSpacecraftIdRef.current === 'starlink'
        ? '#ec4899'
        : selectedSpacecraftIdRef.current === 'landsat'
        ? '#10b981'
        : '#c084fc';
      return Cesium.Color.fromCssColorString(colorStr).withAlpha(alpha);
    }, false);
  }

  // Load imagery provider asynchronously (Cesium v100+ standard)
  useEffect(() => {
    let active = true;

    async function loadProvider() {
      try {
        // Try to load Ion satellite imagery (Asset ID 2 is Bing Maps Satellite)
        const provider = await Cesium.IonImageryProvider.fromAssetId(2);
        if (active) {
          setImageryProvider(provider);
        }
      } catch (error) {
        console.warn('Ion satellite imagery failed to load, falling back to local NaturalEarthII:', error);
        try {
          const fallbackUrl = Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII');
          const provider = await Cesium.TileMapServiceImageryProvider.fromUrl(fallbackUrl);
          if (active) {
            setImageryProvider(provider);
          }
        } catch (fallbackError) {
          console.error('Fallback imagery also failed to load:', fallbackError);
        }
      }
    }

    loadProvider();

    return () => {
      active = false;
    };
  }, []);

  // Callback ref to capture when Resium's Viewer component is mounted
  const viewerRef = (node: any) => {
    if (node?.cesiumElement) {
      setViewer(node.cesiumElement);
      if (typeof window !== 'undefined') {
        (window as any).viewer = node.cesiumElement;
      }
    } else {
      setViewer(null);
    }
  };

  // Set up Cesium viewer settings when instance is resolved
  useEffect(() => {
    if (!viewer) return;

    const scene = viewer.scene;

    // Configure scene properties for lighting and atmosphere
    scene.globe.enableLighting = true;

    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.show = true;
    }
    scene.globe.showGroundAtmosphere = true;

    // Enable clock animation to update the real sun lighting position automatically
    viewer.clock.shouldAnimate = true;
    viewer.clock.multiplier = 1.0;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());

    // Enable high-fidelity realistic rendering features
    viewer.resolutionScale = window.devicePixelRatio || 1.0; // Render at native device pixel ratio for optimal performance
    scene.globe.showWaterEffect = true; // Ocean waves and sun specular reflection on water
    scene.globe.dynamicAtmosphereLighting = true; // Enable dynamic atmosphere lighting for day/night scattering
    scene.globe.maximumScreenSpaceError = 1.5; // Optimized detail threshold for smooth frame rates (Cesium default is 2.0)
    scene.globe.depthTestAgainstTerrain = false; // Disable depth test against terrain so imagery is always visible
    
    if (scene.postProcessStages && scene.postProcessStages.fxaa) {
      scene.postProcessStages.fxaa.enabled = true; // Fast approximate anti-aliasing to smooth edge pixels
    }

    // Load Cesium World Terrain for 3D mountains and valley topography
    try {
      const terrain = Cesium.Terrain.fromWorldTerrain();
      viewer.scene.setTerrain(terrain);
    } catch (error) {
      console.warn('Failed to load world terrain:', error);
    }
    
    // Disable skybox and moon completely to allow custom background to show through
    scene.skyBox = undefined as any;
    scene.moon = undefined as any;
    
    // Disable order independent translucency and HDR to ensure transparency works (safely caught if read-only)
    try {
      (scene as any).orderIndependentTranslucency = false;
    } catch (e) {
      console.warn('orderIndependentTranslucency is read-only in this version of Cesium.');
    }
    try {
      scene.highDynamicRange = false;
    } catch (e) {
      console.warn('highDynamicRange is read-only in this version of Cesium.');
    }
    scene.backgroundColor = new Cesium.Color(0.0, 0.0, 0.0, 0.0);

    // Apply custom imagery settings
    const applyLayerSettings = (layer: Cesium.ImageryLayer) => {
      if (isGraveyardRef.current) {
        layer.brightness = 0.65;
        layer.contrast = 1.35;
        layer.saturation = 0.75;
        layer.gamma = 1.2;
      } else {
        layer.brightness = 1.0;
        layer.contrast = 1.15;
        layer.saturation = 1.1;
        layer.gamma = 1.6;
      }
    };

    // Apply to existing layers
    for (let i = 0; i < viewer.imageryLayers.length; i++) {
      applyLayerSettings(viewer.imageryLayers.get(i));
    }

    // Apply to any layers added in the future
    const removeLayerAddedListener = viewer.imageryLayers.layerAdded.addEventListener((layer) => {
      applyLayerSettings(layer);
    });

    // Safety timeout to ensure globe is faded in even on slow network connections
    const safetyTimeout = setTimeout(() => {
      setIsGlobeReady(true);
    }, 800);

    // Fade in once initial tiles are loaded
    const removeTileLoadListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queueLength) => {
      if (queueLength === 0) {
        setIsGlobeReady(true);
      }
    });

    // Set initial camera view further out for a smooth zoom-in effect
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-45, 20, 2.4e7),
    });

    const canvas = viewer.scene.canvas;
    const handler = new Cesium.ScreenSpaceEventHandler(canvas);
    
    let isMouseDown = false;

    const startInteraction = () => {
      isMouseDown = true;
      isUserInteractingRef.current = true;
      rotationFactorRef.current = 0;
      lastInteractionTimeRef.current = Date.now();
    };

    const stopInteraction = () => {
      isMouseDown = false;
      lastInteractionTimeRef.current = Date.now();
    };

    // Left click/drag
    handler.setInputAction(startInteraction, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(stopInteraction, Cesium.ScreenSpaceEventType.LEFT_UP);
    
    // Right click/drag (panning/zooming)
    handler.setInputAction(startInteraction, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
    handler.setInputAction(stopInteraction, Cesium.ScreenSpaceEventType.RIGHT_UP);

    // Middle click/drag (rotation/tilt)
    handler.setInputAction(startInteraction, Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
    handler.setInputAction(stopInteraction, Cesium.ScreenSpaceEventType.MIDDLE_UP);

    // Mouse movement: updates interaction timestamp when dragging, and handles hover pointer style
    handler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
      if (isKesslerRef.current) {
        if (viewer?.scene?.canvas) {
          viewer.scene.canvas.classList.remove('globe-hover-pointer');
        }
        return;
      }

      if (isMouseDown) {
        lastInteractionTimeRef.current = Date.now();
      }
      
      if (isGraveyardRef.current) {
        setHoveredEntity(null);
        let isHoveringFeatured = false;
        if (viewer) {
          const pickedObject = viewer.scene.pick(movement.endPosition);
          if (Cesium.defined(pickedObject) && pickedObject.id) {
            const rawId = pickedObject.id.id;
            const entId = rawId.endsWith('-pulse') ? rawId.slice(0, -6) : rawId;
            const found = debrisRef.current.find(d => d.id === entId);
            if (found && found.category === 'featured') {
              isHoveringFeatured = true;
            }
          }
        }
        if (viewer?.scene?.canvas) {
          if (isHoveringFeatured) {
            viewer.scene.canvas.classList.add('globe-hover-pointer');
          } else {
            viewer.scene.canvas.classList.remove('globe-hover-pointer');
          }
        }
        return;
      }
      
      let hoveredSatId: string | null = null;
      let isHoveringClickable = false;

      if (viewer) {
        // Track mouse position in state for tooltip
        setMousePos({ x: movement.endPosition.x, y: movement.endPosition.y });

        // Pick object under mouse
        const pickedObject = viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject) && pickedObject.id) {
          const entId = pickedObject.id.id;
          if (entId === 'iss-entity' || entId === 'hubble-entity' || entId === 'tiangong-entity' || entId === 'starlink-entity' || entId === 'landsat-entity') {
            hoveredSatId = entId.replace('-entity', '');
            isHoveringClickable = true;
          }
        }

        // Standard terrain select pointer
        if (onSelectLocationRef.current) {
          const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
          if (cartesian) {
            isHoveringClickable = true;
          }
        }

        if (isHoveringClickable) {
          viewer.scene.canvas.classList.add('globe-hover-pointer');
        } else {
          viewer.scene.canvas.classList.remove('globe-hover-pointer');
        }
      }

      setHoveredEntity(hoveredSatId);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Left click selects coordinates or picks entities
    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      if (!viewer || isKesslerRef.current) return;
      
      if (isGraveyardRef.current) {
        setPopupEntity(null);
        const pickedObject = viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject) && pickedObject.id) {
          const rawId = pickedObject.id.id;
          const entId = rawId.endsWith('-pulse') ? rawId.slice(0, -6) : rawId;
          const found = debrisRef.current.find(d => d.id === entId);
          if (found && found.category === 'featured') {
            if (onSelectFeaturedObjectRef.current) {
              onSelectFeaturedObjectRef.current(found.id);
            }
            lastInteractionTimeRef.current = Date.now();
            isUserInteractingRef.current = true;
            rotationFactorRef.current = 0;
            return;
          }
        }
        if (onSelectFeaturedObjectRef.current) {
          onSelectFeaturedObjectRef.current(null);
        }
        return;
      }
      
      const pickedObject = viewer.scene.pick(movement.position);
      if (Cesium.defined(pickedObject) && pickedObject.id) {
        const entId = pickedObject.id.id;
        if (entId === 'iss-entity' || entId === 'hubble-entity' || entId === 'tiangong-entity' || entId === 'starlink-entity' || entId === 'landsat-entity') {
          const scId = entId.replace('-entity', '');
          // Clicked a spacecraft! Show the popup
          setPopupEntity(scId);
          if (onSelectSpacecraft) {
            onSelectSpacecraft(scId, false); // select it in panel without refocusing camera
          }
          // Pause auto rotation to let user read the info
          lastInteractionTimeRef.current = Date.now();
          isUserInteractingRef.current = true;
          rotationFactorRef.current = 0;
          return;
        }
      }

      // If clicked elsewhere, close popup
      setPopupEntity(null);

      // Select coordinates on the globe (only if onSelectLocation callback is active)
      if (onSelectLocationRef.current) {
        const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
        if (cartesian) {
          const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
          const lon = Cesium.Math.toDegrees(cartographic.longitude);
          const lat = Cesium.Math.toDegrees(cartographic.latitude);
          onSelectLocationRef.current({ lat, lng: lon });
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Zoom/Wheel interaction
    handler.setInputAction(() => {
      isUserInteractingRef.current = true;
      rotationFactorRef.current = 0;
      lastInteractionTimeRef.current = Date.now();
    }, Cesium.ScreenSpaceEventType.WHEEL);

    // Touch gesture pinch zoom/rotate
    handler.setInputAction(() => {
      isUserInteractingRef.current = true;
      rotationFactorRef.current = 0;
      lastInteractionTimeRef.current = Date.now();
    }, Cesium.ScreenSpaceEventType.PINCH_START);

    handler.setInputAction(() => {
      lastInteractionTimeRef.current = Date.now();
    }, Cesium.ScreenSpaceEventType.PINCH_END);

    // Auto-rotation around Earth's Z axis
    const removeListener = viewer.scene.postRender.addEventListener(() => {
      const now = Date.now();
      const timeSinceInteraction = now - lastInteractionTimeRef.current;

      if (timeSinceInteraction > 5000) {
        isUserInteractingRef.current = false;
        // Ramp rotation factor from 0 to 1 over 1.5 seconds
        rotationFactorRef.current = Math.min(
          1.0,
          rotationFactorRef.current + 0.01
        );
      }

      if (!isUserInteractingRef.current && !isKesslerRef.current) {
        const rotationSpeed = 0.05 * rotationFactorRef.current;
        viewer.scene.camera.rotateRight(rotationSpeed * (Math.PI / 180));
      }

      if (!isGraveyardRef.current && !isKesslerRef.current && isISSFocusedRef.current && issLabelRef.current && selectedSpacecraftIdRef.current) {
        let target = null;
        let height = 420000;
        if (selectedSpacecraftIdRef.current === 'iss') {
          target = issTargetRef.current;
          height = 420000;
        } else if (selectedSpacecraftIdRef.current === 'hubble') {
          target = hubbleTargetRef.current;
          height = 540000;
        } else if (selectedSpacecraftIdRef.current === 'tiangong') {
          target = tiangongTargetRef.current;
          height = 390000;
        } else if (selectedSpacecraftIdRef.current === 'starlink') {
          target = starlinkTargetRef.current;
          height = 550000;
        } else if (selectedSpacecraftIdRef.current === 'landsat') {
          target = landsatTargetRef.current;
          height = 705000;
        }

        if (target) {
          const satCartesian = Cesium.Cartesian3.fromDegrees(
            target.lng,
            target.lat,
            height
          );

          const cameraPosition = viewer.camera.position;
          const occluder = new (Cesium as any).EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, cameraPosition);
          const isVisible = occluder.isPointVisible(satCartesian);

          if (isVisible) {
            const projectToWindow = Cesium.SceneTransforms.worldToWindowCoordinates || (Cesium.SceneTransforms as any).wgs84ToWindowCoordinates;
            const windowPos = projectToWindow(viewer.scene, satCartesian);
            if (windowPos) {
              issLabelRef.current.style.display = 'block';
              issLabelRef.current.style.left = `${windowPos.x}px`;
              issLabelRef.current.style.top = `${windowPos.y - 45}px`;
            } else {
              issLabelRef.current.style.display = 'none';
            }
          } else {
            issLabelRef.current.style.display = 'none';
          }
        } else {
          issLabelRef.current.style.display = 'none';
        }
      } else if (issLabelRef.current) {
        issLabelRef.current.style.display = 'none';
      }
    });

    return () => {
      clearTimeout(safetyTimeout);
      removeTileLoadListener();
      removeListener();
      removeLayerAddedListener();
      handler.destroy();
    };
  }, [viewer]);

  // Fly camera to focus when active becomes true
  useEffect(() => {
    if (!viewer || !active) return;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-45, 20, 1.65e7),
      duration: 1.8, // Faster, snappier camera flight
    });
  }, [viewer, active]);

  // Fly camera to targetLocation when coords change
  useEffect(() => {
    if (!viewer || !targetLocation) return;

    // Pause auto-rotation for 5 seconds by resetting interaction timer
    lastInteractionTimeRef.current = Date.now();
    isUserInteractingRef.current = true;
    rotationFactorRef.current = 0;

    const currentHeight = viewer.camera.positionCartographic.height;
    const targetLon = targetLocation.lng ?? (targetLocation as any).lon ?? 0;
    const targetLat = targetLocation.lat;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(targetLon, targetLat, currentHeight),
      duration: 1.8, // Smooth cinematic 1.8 seconds flight duration
    });
  }, [viewer, targetLocation]);

  // Fly camera to focus on the selected spacecraft when spacecraftFocusTrigger changes
  useEffect(() => {
    if (spacecraftFocusTrigger === 0 || !viewer || !selectedSpacecraftId) return;

    // Reset interaction timer to pause auto-rotation
    lastInteractionTimeRef.current = Date.now();
    isUserInteractingRef.current = true;
    rotationFactorRef.current = 0;

    // Get selected spacecraft position
    let target = null;
    let height = 420000;
    if (selectedSpacecraftId === 'iss') {
      target = issTargetRef.current;
      height = 420000;
    } else if (selectedSpacecraftId === 'hubble') {
      target = hubbleTargetRef.current;
      height = 540000;
    } else if (selectedSpacecraftId === 'tiangong') {
      target = tiangongTargetRef.current;
      height = 390000;
    } else if (selectedSpacecraftId === 'starlink') {
      target = starlinkTargetRef.current;
      height = 550000;
    } else if (selectedSpacecraftId === 'landsat') {
      target = landsatTargetRef.current;
      height = 705000;
    }

    if (!target) return;

    const targetLon = target.lng;
    const targetLat = target.lat;
    const cartesian = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, height);

    // Check if the spacecraft is already visible on screen
    let isVisible = false;
    const occluder = new (Cesium as any).EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.position);
    const isPointVisible = occluder.isPointVisible(cartesian);
    
    if (isPointVisible) {
      const projectToWindow = Cesium.SceneTransforms.worldToWindowCoordinates || (Cesium.SceneTransforms as any).wgs84ToWindowCoordinates;
      const windowPos = projectToWindow(viewer.scene, cartesian);
      if (windowPos) {
        const canvas = viewer.scene.canvas;
        if (windowPos.x >= 0 && windowPos.x <= canvas.width &&
            windowPos.y >= 0 && windowPos.y <= canvas.height) {
          isVisible = true;
        }
      }
    }

    const currentHeight = viewer.camera.positionCartographic.height;
    
    // Smooth height adjustment
    const targetHeight = isVisible 
      ? currentHeight 
      : Math.max(7.0e6, Math.min(currentHeight, 1.2e7));

    const destination = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, targetHeight);
    const duration = isVisible ? 1.5 : 2.2;

    viewer.camera.flyTo({
      destination,
      duration,
    });

    setIsISSFocused(true);
    const timer = setTimeout(() => {
      setIsISSFocused(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, [spacecraftFocusTrigger, viewer]);

  const prevSelectedFeaturedRef = useRef<string | null>(null);

  // Camera flight when a featured object is selected or deselected in Graveyard Mode
  useEffect(() => {
    if (!viewer || !isGraveyard) return;

    if (selectedFeaturedObjectId) {
      const targetObj = debrisRef.current.find(d => d.id === selectedFeaturedObjectId);
      if (targetObj) {
        lastInteractionTimeRef.current = Date.now();
        isUserInteractingRef.current = true;
        rotationFactorRef.current = 0;

        const currentTime = viewer.clock.currentTime;
        const positionCartesian = targetObj.positionProperty.getValue(currentTime);
        if (positionCartesian) {
          let isVisible = false;
          const occluder = new (Cesium as any).EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.position);
          const isPointVisible = occluder.isPointVisible(positionCartesian);
          
          if (isPointVisible) {
            const projectToWindow = Cesium.SceneTransforms.worldToWindowCoordinates || (Cesium.SceneTransforms as any).wgs84ToWindowCoordinates;
            const windowPos = projectToWindow(viewer.scene, positionCartesian);
            if (windowPos) {
              const canvas = viewer.scene.canvas;
              if (windowPos.x >= 0 && windowPos.x <= canvas.width &&
                  windowPos.y >= 0 && windowPos.y <= canvas.height) {
                isVisible = true;
              }
            }
          }

          if (!isVisible) {
            const currentHeight = viewer.camera.positionCartographic.height;
            const cartographic = Cesium.Cartographic.fromCartesian(positionCartesian);
            const targetLon = Cesium.Math.toDegrees(cartographic.longitude);
            const targetLat = Cesium.Math.toDegrees(cartographic.latitude);
            const destination = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, currentHeight);

            viewer.camera.flyTo({
              destination,
              duration: 2.0,
            });
          }
        }
      }
    } else if (prevSelectedFeaturedRef.current !== null && isGraveyard) {
      const currentTime = viewer.clock.currentTime;
      let lon = -45;
      let lat = 20;

      try {
        if ((Cesium as any).Simon1994PlanetaryPositions) {
          const sunPos = (Cesium as any).Simon1994PlanetaryPositions.computeSunPositionInEarthFixed(currentTime);
          if (Cesium.defined(sunPos)) {
            const nightPos = Cesium.Cartesian3.negate(sunPos, new Cesium.Cartesian3());
            const nightCarto = Cesium.Cartographic.fromCartesian(nightPos);
            if (nightCarto) {
              lon = Cesium.Math.toDegrees(nightCarto.longitude);
              lat = Cesium.Math.toDegrees(nightCarto.latitude);
            }
          }
        }
      } catch (e) {}

      lastInteractionTimeRef.current = Date.now();
      isUserInteractingRef.current = true;
      rotationFactorRef.current = 0;

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1.8e7),
        duration: 2.0,
      });
    }

    prevSelectedFeaturedRef.current = selectedFeaturedObjectId ?? null;
  }, [viewer, selectedFeaturedObjectId, isGraveyard]);

  // Continuously resize Cesium viewer canvas during layout width transition (1.2 seconds)
  useEffect(() => {
    if (!viewer) return;

    let startTime = Date.now();
    let frameId: number;

    const resizeLoop = () => {
      viewer.resize();
      if (Date.now() - startTime < 1300) {
        frameId = requestAnimationFrame(resizeLoop);
      }
    };

    frameId = requestAnimationFrame(resizeLoop);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [viewer, targetLocation, selectedFeaturedObjectId, isKessler]);

  // Dynamically update globe settings when entering/exiting Graveyard Mode
  useEffect(() => {
    if (!viewer) return;

    const scene = viewer.scene;

    const applySettings = (layer: Cesium.ImageryLayer) => {
      if (isGraveyard) {
        layer.brightness = 0.65;
        layer.contrast = 1.35;
        layer.saturation = 0.75;
        layer.gamma = 1.2;
      } else {
        layer.brightness = 1.0;
        layer.contrast = 1.15;
        layer.saturation = 1.1;
        layer.gamma = 1.6;
      }
    };

    // Apply settings to all active imagery layers
    for (let i = 0; i < viewer.imageryLayers.length; i++) {
      applySettings(viewer.imageryLayers.get(i));
    }

    // Configure atmospheric scattering and hue/saturation/brightness shifts
    // to transform the standard blue glow to deep red/crimson.
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.hueShift = (isGraveyard || isKessler) ? -0.65 : 0.0;
      scene.skyAtmosphere.saturationShift = (isGraveyard || isKessler) ? 0.3 : 0.0;
      scene.skyAtmosphere.brightnessShift = (isGraveyard || isKessler) ? -0.15 : 0.0;
    }

    scene.globe.atmosphereHueShift = (isGraveyard || isKessler) ? -0.65 : 0.0;
    scene.globe.atmosphereSaturationShift = (isGraveyard || isKessler) ? 0.3 : 0.0;
    scene.globe.atmosphereBrightnessShift = (isGraveyard || isKessler) ? -0.15 : 0.0;

    scene.globe.enableLighting = !(isGraveyard || isKessler);
    scene.globe.dynamicAtmosphereLighting = !(isGraveyard || isKessler);
    scene.globe.dynamicAtmosphereLightingFromSun = !(isGraveyard || isKessler);

    try {
      if ((scene as any).atmosphere) {
        (scene as any).atmosphere.dynamicLighting = (isGraveyard || isKessler)
          ? (Cesium as any).DynamicAtmosphereLightingType.NONE 
          : (Cesium as any).DynamicAtmosphereLightingType.SUNLIGHT;
      }
    } catch (e) {
      console.warn("Unified atmosphere lighting configuration skipped:", e);
    }

    // Handle camera flight based on active mode
    if (isKessler) {
      wasKesslerRef.current = true;

      // Calculate dynamic camera pitch based on canvas aspect ratio to ensure
      // the Earth's horizon peak is consistently positioned at the bottom 25-30% across all screen sizes
      let pitchDeg = -43.0;
      if (viewer.scene && viewer.scene.canvas) {
        const canvas = viewer.scene.canvas;
        const ar = canvas.clientWidth / canvas.clientHeight;
        // Linear correction: taller viewports (smaller ar) need more negative pitch to push the globe down
        pitchDeg = -43.0 + (ar - 1.64) * 16.0;
      }
      const clampedPitch = Math.max(-52.0, Math.min(-35.0, pitchDeg));

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-80, 0, 4.0e6),
        orientation: {
          heading: Cesium.Math.toRadians(0.0),
          pitch: Cesium.Math.toRadians(clampedPitch),
          roll: 0.0,
        },
        duration: 2.5,
      });
    } else if (isGraveyard) {
      wasGraveyardRef.current = true;
      const currentTime = viewer.clock.currentTime;
      let lon = -45;
      let lat = 20;

      try {
        if ((Cesium as any).Simon1994PlanetaryPositions) {
          const sunPos = (Cesium as any).Simon1994PlanetaryPositions.computeSunPositionInEarthFixed(currentTime);
          if (Cesium.defined(sunPos)) {
            // Antipode point is opposite of the sun position vector (facing midnight/dark side center)
            const nightPos = Cesium.Cartesian3.negate(sunPos, new Cesium.Cartesian3());
            const nightCarto = Cesium.Cartographic.fromCartesian(nightPos);
            if (nightCarto) {
              lon = Cesium.Math.toDegrees(nightCarto.longitude);
              lat = Cesium.Math.toDegrees(nightCarto.latitude);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to compute precise sun positions:", e);
      }

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 1.8e7),
        duration: 2.0,
      });
    } else {
      if (wasGraveyardRef.current || wasKesslerRef.current) {
        wasGraveyardRef.current = false;
        wasKesslerRef.current = false;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(-45, 20, 1.65e7),
          duration: 2.0,
        });
      }
    }
  }, [viewer, isGraveyard, isKessler]);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      position: 'relative', 
      overflow: 'hidden', 
      background: 'transparent' 
    }}>
      {/* Transparent Viewer positioned above the background star layer */}
      <div 
        className={`globe-viewer-wrapper ${targetLocation ? "has-target" : ""} ${isGraveyard ? "in-graveyard" : ""} ${selectedFeaturedObjectId ? "has-featured" : ""} ${isKessler ? "in-kessler" : ""} ${kesslerSimState === 'impact' || kesslerSimState === 'cascade_impact' || kesslerSimState === 'final_impact_1' || kesslerSimState === 'final_impact_2' || kesslerSimState === 'final_impact_3' ? "camera-shake-active" : ""}`}
        style={{ 
          opacity: (active && isGlobeReady) ? 1 : 0,
        }}
      >
        <Viewer
          ref={viewerRef}
          full
          style={{ width: '100%', height: '100%', background: 'transparent' }}
          contextOptions={CONTEXT_OPTIONS}
          {...{ imageryProvider: false } as any}
          skyBox={false}
          timeline={false}
          animation={false}
          baseLayerPicker={false}
          homeButton={false}
          navigationHelpButton={false}
          sceneModePicker={false}
          geocoder={false}
          fullscreenButton={false}
          selectionIndicator={false}
          infoBox={false}
        >
          {imageryProvider && <ImageryLayer imageryProvider={imageryProvider} />}

          {/* Kessler Simulation Satellites */}
          {isKessler && kesslerSatellitesWithProperties.map((sat) => {
            const isFeatured = sat.isFeatured;
            const isPostFirstImpact = [
              'impact',
              'debris_drifting',
              'cascade_approach',
              'cascade_impact',
              'cascade_escalating',
              'final_highlight',
              'final_approach',
              'final_impact_1',
              'final_impact_2',
              'final_impact_3',
              'kessler_cascade_active',
            ].includes(kesslerSimState);

            if (isFeatured && isPostFirstImpact) {
              return null;
            }

            const finalPairIndex = finalCascadePairs.findIndex((p) => p.satId === sat.id);
            const finalImpactStates: KesslerSimState[] = [
              'final_impact_1',
              'final_impact_2',
              'final_impact_3',
              'kessler_cascade_active',
            ];
            if (
              finalPairIndex >= 0 &&
              isStateAtOrAfter(kesslerSimState, finalImpactStates[finalPairIndex])
            ) {
              return null;
            }

            const isCascadeTarget =
              sat.id === cascadeTargetSatId &&
              (kesslerSimState === 'cascade_approach' || kesslerSimState === 'cascade_impact');

            if (
              sat.id === cascadeTargetSatId &&
              (kesslerSimState === 'cascade_impact' ||
                kesslerSimState === 'cascade_escalating' ||
                isFinalPhaseState(kesslerSimState))
            ) {
              return null;
            }

            const isFinalTarget =
              finalPairIndex >= 0 &&
              (kesslerSimState === 'final_highlight' || kesslerSimState === 'final_approach') &&
              (kesslerSimState === 'final_approach' || finalPairIndex < finalHighlightStage);

            const img = isFeatured ? kesslerFeaturedSatImage : kesslerStandardSatImage;

            if (!img) return null;

            return (
              <Fragment key={sat.id}>
                {isCascadeTarget && kesslerSimState === 'cascade_approach' && (
                  <Entity id={`${sat.id}-target-glow`} position={sat.positionProperty as any}>
                    <BillboardGraphics
                      image={BLUE_TARGET_GLOW}
                      scale={targetSatPulseScale as any}
                      color={targetSatPulseColor as any}
                      width={128}
                      height={128}
                    />
                  </Entity>
                )}
                {isFinalTarget && (
                  <Entity id={`${sat.id}-final-target-glow`} position={sat.positionProperty as any}>
                    <BillboardGraphics
                      image={BLUE_TARGET_GLOW}
                      scale={targetSatPulseScale as any}
                      color={targetSatPulseColor as any}
                      width={128}
                      height={128}
                    />
                  </Entity>
                )}
                <Entity
                  id={sat.id}
                  name={sat.name}
                  position={sat.positionProperty as any}
                >
                  <BillboardGraphics
                    image={img}
                    color={sat.colorProperty as any}
                    scale={
                      isFeatured
                        ? (sat.scaleProperty as any)
                        : isCascadeTarget || isFinalTarget
                        ? (targetSatPulseScale as any)
                        : 0.75
                    }
                    width={96}
                    height={96}
                  />
                </Entity>
              </Fragment>
            );
          })}

          {/* Crimson Connection Line between featured satellites representing predicted collision path */}
          {isKessler && (kesslerSimState === 'countdown' || kesslerSimState === 'frozen' || kesslerSimState === 'collision_sequence') && polylinePositions && polylineMaterial && (
            <Entity id="kessler-trajectory-line">
              <PolylineGraphics
                positions={polylinePositions}
                width={2.5}
                material={polylineMaterial}
              />
            </Entity>
          )}

          {/* Impact White Flash and Shockwave */}
          {isKessler && kesslerSimState === 'impact' && midpointPosition && (
            <>
              {/* White Radial Glow Flash */}
              <Entity
                id="kessler-collision-flash"
                position={midpointPosition as any}
              >
                <BillboardGraphics
                  image={FLASH_SVG}
                  scale={flashScaleProperty as any}
                  width={128}
                  height={128}
                />
              </Entity>

              {/* Shockwave expanding ring */}
              <Entity
                id="kessler-collision-shockwave"
                position={midpointPosition as any}
              >
                <BillboardGraphics
                  image={SHOCKWAVE_SVG}
                  scale={shockwaveScaleProperty as any}
                  color={shockwaveColorProperty as any}
                  width={128}
                  height={128}
                />
              </Entity>
            </>
          )}

          {/* Secondary cascade impact flash and shockwave */}
          {isKessler && kesslerSimState === 'cascade_impact' && secondaryImpactPosition && (
            <>
              <Entity id="kessler-secondary-flash" position={secondaryImpactPosition as any}>
                <BillboardGraphics
                  image={FLASH_SVG}
                  scale={secondaryFlashScaleProperty as any}
                  width={128}
                  height={128}
                />
              </Entity>
              <Entity id="kessler-secondary-shockwave" position={secondaryImpactPosition as any}>
                <BillboardGraphics
                  image={SHOCKWAVE_SVG}
                  scale={secondaryShockwaveScaleProperty as any}
                  color={secondaryShockwaveColorProperty as any}
                  width={128}
                  height={128}
                />
              </Entity>
            </>
          )}

          {/* Phase 6: final cascade impact flashes and shockwaves */}
          {isKessler &&
            finalImpactEffects.map((effect, idx) => {
              const flashScale = new Cesium.CallbackProperty(() => {
                const elapsed = Date.now() - effect.time;
                if (elapsed < 0 || elapsed > 600) return 0.0;
                return 5.0 * (1.0 - elapsed / 600);
              }, false);
              const shockwaveScale = new Cesium.CallbackProperty(() => {
                const elapsed = Date.now() - effect.time;
                if (elapsed < 0 || elapsed > 800) return 0.0;
                return 10.0 * (elapsed / 800);
              }, false);
              const shockwaveColor = new Cesium.CallbackProperty(() => {
                const elapsed = Date.now() - effect.time;
                if (elapsed < 0 || elapsed > 800) return Cesium.Color.WHITE.withAlpha(0.0);
                return Cesium.Color.WHITE.withAlpha(0.85 * (1.0 - elapsed / 800));
              }, false);

              return (
                <Fragment key={`final-impact-${effect.time}-${idx}`}>
                  <Entity id={`kessler-final-flash-${idx}`} position={effect.position as any}>
                    <BillboardGraphics
                      image={FLASH_SVG}
                      scale={flashScale as any}
                      width={128}
                      height={128}
                    />
                  </Entity>
                  <Entity id={`kessler-final-shockwave-${idx}`} position={effect.position as any}>
                    <BillboardGraphics
                      image={SHOCKWAVE_SVG}
                      scale={shockwaveScale as any}
                      color={shockwaveColor as any}
                      width={128}
                      height={128}
                    />
                  </Entity>
                </Fragment>
              );
            })}

          {/* Kessler Collision Debris Cloud */}
          {isKessler &&
            [
              'impact',
              'debris_drifting',
              'cascade_approach',
              'cascade_impact',
              'cascade_escalating',
              'final_highlight',
              'final_approach',
              'final_impact_1',
              'final_impact_2',
              'final_impact_3',
              'kessler_cascade_active',
            ].includes(kesslerSimState) &&
            kesslerDebris.map((d) => {
              const finalPairIndex = finalCascadePairs.findIndex((p) => p.debrisId === d.id);
              const finalImpactStates: KesslerSimState[] = [
                'final_impact_1',
                'final_impact_2',
                'final_impact_3',
                'kessler_cascade_active',
              ];
              if (
                finalPairIndex >= 0 &&
                isStateAtOrAfter(kesslerSimState, finalImpactStates[finalPairIndex])
              ) {
                return null;
              }

              const isPhase5Dangerous =
                d.isDangerous &&
                d.id === cascadeDangerousDebrisId &&
                kesslerSimState === 'cascade_approach';

              const isFinalDangerous =
                finalPairIndex >= 0 &&
                (kesslerSimState === 'final_approach' ||
                  (kesslerSimState === 'final_highlight' && finalPairIndex < finalHighlightStage));

              const isDangerous = isPhase5Dangerous || isFinalDangerous;

              return (
                <Fragment key={d.id}>
                  {isDangerous && (
                    <>
                      <Entity id={`${d.id}-trail`} position={d.positionProperty as any}>
                        <BillboardGraphics
                          image={CRIMSON_DEBRIS_GLOW}
                          scale={0.6}
                          color={Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.25)}
                          width={32}
                          height={32}
                        />
                      </Entity>
                      <Entity id={`${d.id}-glow`} position={d.positionProperty as any}>
                        <BillboardGraphics
                          image={CRIMSON_DEBRIS_GLOW}
                          scale={dangerousDebrisPulseScale as any}
                          color={dangerousDebrisPulseColor as any}
                          width={32}
                          height={32}
                        />
                      </Entity>
                    </>
                  )}
                  <Entity id={d.id} position={d.positionProperty as any}>
                    <BillboardGraphics
                      image={d.image}
                      width={isDangerous ? 18 : 14}
                      height={isDangerous ? 18 : 14}
                      rotation={d.rotationProperty as any}
                      scale={isDangerous ? (dangerousDebrisPulseScale as any) : d.scaleFactor}
                      color={
                        isDangerous
                          ? (dangerousDebrisPulseColor as any)
                          : undefined
                      }
                    />
                  </Entity>
                </Fragment>
              );
            })}

          {/* Orbital Debris Layer (glowing red points, orange rockets, gray satellites) in Graveyard Mode */}
          {isGraveyard && !isKessler && debris.map((d) => {
            if (d.category === 'debris') {
              return (
                <Entity
                  key={d.id}
                  id={d.id}
                  position={d.positionProperty as any}
                >
                  <PointGraphics
                    color={Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.85)}
                    pixelSize={2.5}
                    outlineColor={Cesium.Color.fromCssColorString('#991b1b').withAlpha(0.3)}
                    outlineWidth={4}
                  />
                </Entity>
              );
            } else if (d.category === 'rocketBody') {
              return rocketMarkerImage ? (
                <Entity
                  key={d.id}
                  id={d.id}
                  position={d.positionProperty as any}
                >
                  <BillboardGraphics
                    image={rocketMarkerImage}
                    width={36}
                    height={36}
                  />
                </Entity>
              ) : null;
            } else if (d.category === 'inactiveSatellite') {
              return inactiveSatelliteMarkerImage ? (
                <Entity
                  key={d.id}
                  id={d.id}
                  position={d.positionProperty as any}
                >
                  <BillboardGraphics
                    image={inactiveSatelliteMarkerImage}
                    width={45}
                    height={45}
                  />
                </Entity>
              ) : null;
            } else if (d.category === 'featured') {
              const isSelected = selectedFeaturedObjectId === d.id;
              return featuredMarkerImage ? (
                <Fragment key={d.id}>
                  <Entity
                    id={d.id}
                    position={d.positionProperty as any}
                  >
                    <BillboardGraphics
                      image={featuredMarkerImage}
                      scale={isSelected ? 1.25 : (featuredScaleRef.current as any)}
                      color={isSelected ? Cesium.Color.WHITE : (featuredColorRef.current as any)}
                      width={100}
                      height={100}
                    />
                  </Entity>
                  {!isSelected && featuredPulseMarkerImage && featuredPulseScaleRef.current && featuredPulseColorRef.current && (
                    <Entity
                      id={`${d.id}-pulse`}
                      position={d.positionProperty as any}
                    >
                      <BillboardGraphics
                        image={featuredPulseMarkerImage}
                        scale={featuredPulseScaleRef.current as any}
                        color={featuredPulseColorRef.current as any}
                        width={100}
                        height={100}
                      />
                    </Entity>
                  )}
                </Fragment>
              ) : null;
            }
            return null;
          })}
          
          {/* Live Focused Marker - Focused backing glow / targeting reticle */}
          {!isGraveyard && !isKessler && selectedSpacecraftId && focusBasePositionProperty.current && isISSFocused && issFocusBaseImage && (
            <Entity
              id="spacecraft-focus-base"
              name="Spacecraft Focus Base"
              position={focusBasePositionProperty.current as any}
            >
              <BillboardGraphics
                image={issFocusBaseImage}
                scale={0.9}
                color={
                  selectedSpacecraftId === 'tiangong' 
                    ? Cesium.Color.fromCssColorString('#fbbf24') 
                    : selectedSpacecraftId === 'hubble'
                    ? Cesium.Color.fromCssColorString('#38bdf8')
                    : Cesium.Color.fromCssColorString('#c084fc')
                }
                width={80}
                height={80}
              />
            </Entity>
          )}

          {/* Live Focused Marker - Focused pulse outer ring */}
          {!isGraveyard && !isKessler && selectedSpacecraftId && focusPulsePositionProperty.current && isISSFocused && issFocusPulseImage && issFocusPulseScaleRef.current && issFocusPulseColorRef.current && (
            <Entity
              id="spacecraft-focus-pulse"
              name="Spacecraft Focus Pulse"
              position={focusPulsePositionProperty.current as any}
            >
              <BillboardGraphics
                image={issFocusPulseImage}
                scale={issFocusPulseScaleRef.current as any}
                color={issFocusPulseColorRef.current as any}
                width={100}
                height={100}
              />
            </Entity>
          )}

          {/* Live ISS Marker - Main Marker */}
          {!isGraveyard && !isKessler && issData?.latitude !== null && issData?.longitude !== null && issPositionProperty.current && issMarkerImage && (
            <Entity
              id="iss-entity"
              name="ISS"
              position={issPositionProperty.current as any}
            >
              <BillboardGraphics
                image={issMarkerImage}
                scale={issScaleRef.current as any}
                color={issColorRef.current as any}
                width={72}
                height={72}
              />
            </Entity>
          )}

          {/* Hubble Marker */}
          {!isGraveyard && !isKessler && hubbleData?.latitude !== null && hubbleData?.longitude !== null && hubblePositionProperty.current && hubbleMarkerImage && (
            <Entity
              id="hubble-entity"
              name="Hubble"
              position={hubblePositionProperty.current as any}
            >
              <BillboardGraphics
                image={hubbleMarkerImage}
                scale={hubbleScaleRef.current as any}
                color={issColorRef.current as any}
                width={72}
                height={72}
              />
            </Entity>
          )}

          {/* Tiangong Marker */}
          {!isGraveyard && !isKessler && tiangongData?.latitude !== null && tiangongData?.longitude !== null && tiangongPositionProperty.current && tiangongMarkerImage && (
            <Entity
              id="tiangong-entity"
              name="Tiangong"
              position={tiangongPositionProperty.current as any}
            >
              <BillboardGraphics
                image={tiangongMarkerImage}
                scale={tiangongScaleRef.current as any}
                color={issColorRef.current as any}
                width={72}
                height={72}
              />
            </Entity>
          )}

          {/* Starlink Marker */}
          {!isGraveyard && !isKessler && starlinkData?.latitude !== null && starlinkData?.longitude !== null && starlinkPositionProperty.current && starlinkMarkerImage && (
            <Entity
              id="starlink-entity"
              name="Starlink"
              position={starlinkPositionProperty.current as any}
            >
              <BillboardGraphics
                image={starlinkMarkerImage}
                scale={starlinkScaleRef.current as any}
                color={issColorRef.current as any}
                width={72}
                height={72}
              />
            </Entity>
          )}

          {/* Landsat Marker */}
          {!isGraveyard && !isKessler && landsatData?.latitude !== null && landsatData?.longitude !== null && landsatPositionProperty.current && landsatMarkerImage && (
            <Entity
              id="landsat-entity"
              name="Landsat"
              position={landsatPositionProperty.current as any}
            >
              <BillboardGraphics
                image={landsatMarkerImage}
                scale={landsatScaleRef.current as any}
                color={issColorRef.current as any}
                width={72}
                height={72}
              />
            </Entity>
          )}

          {!isGraveyard && !isKessler && targetLocation && baseMarkerImage && pulseMarkerImage && (
            <Entity
              position={Cesium.Cartesian3.fromDegrees(targetLocation.lng ?? (targetLocation as any).lon ?? 0, targetLocation.lat)}
              name="Target Location"
            >
              {/* Pulsing ring billboard */}
              <BillboardGraphics
                image={pulseMarkerImage}
                scale={pulseScaleRef.current as any}
                color={pulseColorRef.current as any}
                width={128}
                height={128}
              />
              {/* Fixed target center & glow billboard */}
              <BillboardGraphics
                image={baseMarkerImage}
                scale={baseScaleRef.current as any}
                color={baseColorRef.current as any}
                width={128}
                height={128}
              />
              {/* Volumetric vertical light beacon */}
              <CylinderGraphics
                length={2000000.0} // 2000 km length (extends 1000 km above surface, 1000 km clipped inside Earth)
                topRadius={12000.0} // 12 km radius
                bottomRadius={12000.0}
                material={new Cesium.ColorMaterialProperty(
                  new Cesium.CallbackProperty(() => {
                    const t = (Date.now() % 3000) / 3000 * Math.PI * 2;
                    const alpha = 0.07 + 0.03 * Math.sin(t); // Gentle breathing opacity
                    return Cesium.Color.fromCssColorString('#05ffc3').withAlpha(alpha);
                  }, false)
                )}
                outline={false}
              />
            </Entity>
          )}
        </Viewer>

        {/* Kessler Mode Collision Warning Overlay */}
        {isKessler && (kesslerSimState === 'countdown' || kesslerSimState === 'frozen') && (
          <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-[100] flex flex-col items-center select-none pointer-events-none">
            <div className="w-[280px] md:w-[320px] bg-black/75 backdrop-blur-md border border-red-500/30 rounded-xl px-4 py-3 shadow-[0_0_25px_rgba(239,68,68,0.2)] flex flex-col items-center">
              <div className="flex items-center gap-1.5 justify-center">
                <span className="text-red-500 text-sm animate-pulse">⚠</span>
                <h4 className="text-red-400 font-bold text-xs md:text-sm tracking-[0.12em] uppercase font-inter">
                  COLLISION PREDICTED
                </h4>
              </div>
              <p className="text-slate-300/90 text-[10px] md:text-[11px] mt-1 text-center font-inter font-medium leading-relaxed">
                Potential orbital intersection detected.
              </p>

              {/* Countdown display */}
              {kesslerSimState === 'countdown' && (
                <div className="flex flex-col items-center mt-3 pt-2.5 border-t border-red-500/10 w-full">
                  <span className="text-slate-400 text-[9px] uppercase tracking-[0.14em] font-semibold font-inter">
                    COLLISION IN
                  </span>
                  <div key={kesslerCountdown} className="text-red-500 font-black text-3xl md:text-4xl mt-1.5 font-inter animate-countdown">
                    {kesslerCountdown}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Hover Tooltip Overlay */}
      {!isGraveyard && !isKessler && hoveredEntity && (
        <div 
          className={`fixed z-[100] pointer-events-none bg-slate-950/85 border text-white rounded-lg p-2.5 backdrop-blur-md font-outfit ${
            hoveredEntity === 'tiangong' 
              ? 'border-amber-500/35 shadow-[0_4px_20px_rgba(0,0,0,0.5),0_0_12px_rgba(251,191,36,0.18)]' 
              : hoveredEntity === 'hubble'
              ? 'border-sky-500/35 shadow-[0_4px_20px_rgba(0,0,0,0.5),0_0_12px_rgba(56,189,248,0.18)]'
              : hoveredEntity === 'starlink'
              ? 'border-pink-500/35 shadow-[0_4px_20px_rgba(0,0,0,0.5),0_0_12px_rgba(236,72,153,0.18)]'
              : hoveredEntity === 'landsat'
              ? 'border-emerald-500/35 shadow-[0_4px_20px_rgba(0,0,0,0.5),0_0_12px_rgba(16,185,129,0.18)]'
              : 'border-[#c084fc]/35 shadow-[0_4px_20px_rgba(0,0,0,0.5),0_0_12px_rgba(192,132,252,0.18)]'
          }`}
          style={{
            left: `${mousePos.x + 15}px`,
            top: `${mousePos.y + 15}px`,
          }}
        >
          <div className={`text-[10px] font-semibold font-orbitron tracking-wider ${
            hoveredEntity === 'tiangong' 
              ? 'text-amber-400' 
              : hoveredEntity === 'hubble'
              ? 'text-sky-400'
              : hoveredEntity === 'starlink'
              ? 'text-pink-400'
              : hoveredEntity === 'landsat'
              ? 'text-emerald-400'
              : 'text-[#c084fc]'
          }`}>
            {hoveredEntity === 'tiangong' 
              ? 'TIANGONG' 
              : hoveredEntity === 'hubble' 
              ? 'HUBBLE' 
              : hoveredEntity === 'starlink'
              ? 'STARLINK'
              : hoveredEntity === 'landsat'
              ? 'LANDSAT 9'
              : 'ISS'}
          </div>
          <div className="text-[9px] text-slate-300">
            {hoveredEntity === 'tiangong' 
              ? 'Tiangong Space Station' 
              : hoveredEntity === 'hubble'
              ? 'Hubble Space Telescope'
              : hoveredEntity === 'starlink'
              ? 'Starlink Satellite'
              : hoveredEntity === 'landsat'
              ? 'Landsat 9 Satellite'
              : 'International Space Station'}
          </div>
        </div>
      )}

      {/* Detail click popup overlay */}
      {!isGraveyard && !isKessler && popupEntity && (
        <div 
          className={`fixed left-1/2 bottom-12 md:bottom-16 -translate-x-1/2 z-[100] w-[240px] md:w-[260px] bg-slate-950/90 border text-white rounded-xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.65)] backdrop-blur-md font-outfit animate-in fade-in slide-in-from-bottom-4 duration-300 ${
            popupEntity === 'tiangong' 
              ? 'border-amber-500/45 shadow-[0_0_24px_rgba(251,191,36,0.25)]' 
              : popupEntity === 'hubble'
              ? 'border-sky-500/45 shadow-[0_0_24px_rgba(56,189,248,0.25)]'
              : popupEntity === 'starlink'
              ? 'border-pink-500/45 shadow-[0_0_24px_rgba(236,72,153,0.25)]'
              : popupEntity === 'landsat'
              ? 'border-emerald-500/45 shadow-[0_0_24px_rgba(16,185,129,0.25)]'
              : 'border-[#c084fc]/45 shadow-[0_0_24px_rgba(192,132,252,0.25)]'
          }`}
        >
          <div className="flex justify-between items-center border-b border-white/10 pb-2 mb-2.5">
            <h4 className={`text-[11px] font-bold font-orbitron tracking-wider uppercase ${
              popupEntity === 'tiangong' 
                ? 'text-amber-400' 
                : popupEntity === 'hubble'
                ? 'text-sky-400'
                : popupEntity === 'starlink'
                ? 'text-pink-400'
                : popupEntity === 'landsat'
                ? 'text-emerald-400'
                : 'text-[#c084fc]'
            }`}>
              {popupEntity === 'tiangong' 
                ? 'Tiangong Telemetry' 
                : popupEntity === 'hubble'
                ? 'Hubble Telemetry'
                : popupEntity === 'starlink'
                ? 'Starlink Telemetry'
                : popupEntity === 'landsat'
                ? 'Landsat 9 Telemetry'
                : 'ISS Telemetry'}
            </h4>
            <button 
              onClick={() => setPopupEntity(null)}
              className="text-slate-400 hover:text-white border-none bg-transparent cursor-pointer text-xs transition-colors"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-1.5 text-[10px]">
            {(() => {
              const sc = spacecrafts.find(s => s.id === popupEntity);
              return (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Latitude</span>
                    <span className="font-mono text-slate-300">
                      {sc?.latitude !== null && sc?.latitude !== undefined ? `${sc.latitude.toFixed(4)}°` : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Longitude</span>
                    <span className="font-mono text-slate-300">
                      {sc?.longitude !== null && sc?.longitude !== undefined ? `${sc.longitude.toFixed(4)}°` : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Altitude</span>
                    <span className="font-mono text-slate-300">
                      {sc?.altitude !== null && sc?.altitude !== undefined ? `${sc.altitude.toFixed(1)} km` : "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-t border-white/5 pt-2 mt-1">
                    <span className="text-slate-500 font-medium">Last Updated</span>
                    <span className="font-mono text-slate-300">
                      {sc?.timestamp !== null && sc?.timestamp !== undefined ? new Date(sc.timestamp * 1000).toLocaleTimeString() : "N/A"}
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Floating Spacecraft label when focused */}
      <div 
        ref={issLabelRef}
        className={`fixed z-[100] pointer-events-none -translate-x-1/2 -translate-y-full bg-slate-950/85 border text-white rounded-lg px-3 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-md font-outfit text-center transition-all duration-300 ${
          selectedSpacecraftId === 'tiangong' 
            ? 'border-amber-500/50 shadow-[0_0_12px_rgba(251,191,36,0.25)]' 
            : selectedSpacecraftId === 'hubble'
            ? 'border-sky-500/50 shadow-[0_0_12px_rgba(56,189,248,0.25)]'
            : selectedSpacecraftId === 'starlink'
            ? 'border-pink-500/50 shadow-[0_0_12px_rgba(236,72,153,0.25)]'
            : selectedSpacecraftId === 'landsat'
            ? 'border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
            : 'border-[#c084fc]/50 shadow-[0_0_12px_rgba(192,132,252,0.25)]'
        }`}
        style={{ display: 'none', position: 'fixed' }}
      >
        <div className={`text-[10px] font-bold font-orbitron tracking-wider leading-none mb-1 ${
          selectedSpacecraftId === 'tiangong' 
            ? 'text-amber-400' 
            : selectedSpacecraftId === 'hubble'
            ? 'text-sky-400'
            : selectedSpacecraftId === 'starlink'
            ? 'text-pink-400'
            : selectedSpacecraftId === 'landsat'
            ? 'text-emerald-400'
            : 'text-[#c084fc]'
        }`}>
          {selectedSpacecraftId === 'tiangong' 
            ? 'CSS' 
            : selectedSpacecraftId === 'hubble'
            ? 'HST'
            : selectedSpacecraftId === 'starlink'
            ? 'SL-1209'
            : selectedSpacecraftId === 'landsat'
            ? 'LDST9'
            : 'ISS'}
        </div>
        <div className="text-[8px] text-slate-300 uppercase tracking-widest font-semibold whitespace-nowrap">
          {selectedSpacecraftId === 'tiangong' 
            ? 'Tiangong Space Station' 
            : selectedSpacecraftId === 'hubble'
            ? 'Hubble Space Telescope'
            : selectedSpacecraftId === 'starlink'
            ? 'Starlink Satellite'
            : selectedSpacecraftId === 'landsat'
            ? 'Landsat 9 Satellite'
            : 'International Space Station'}
        </div>
      </div>
    </div>
  );
}
