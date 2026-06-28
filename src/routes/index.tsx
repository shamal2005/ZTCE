import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import heroImage from "@/assets/zenith-hero.jpg";
import GlobeView from "../components/GlobeView";
import NavigationPanel from "../components/NavigationPanel";
import ZenithLocationPanel from "../components/ZenithLocationPanel";
import ZenithIntelligencePanel from "../components/ZenithIntelligencePanel";
import GraveyardIntroPanel from "../components/GraveyardIntroPanel";
import GraveyardIntelligencePanel from "../components/GraveyardIntelligencePanel";
import KesslerIntroPanel from "../components/KesslerIntroPanel";
import {
  type KesslerSimState,
  CASCADE_SETTLE_MS,
  CASCADE_APPROACH_MS,
  CASCADE_IMPACT_MS,
  FINAL_BUILDUP_MS,
  FINAL_HIGHLIGHT_DURATION_MS,
  FINAL_APPROACH_MS,
  FINAL_COLLISION_STAGGER_MS,
} from "../types/kessler";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ZENITH — The Celestial Eye" },
      {
        name: "description",
        content:
          "ZENITH — The Celestial Eye. A quiet hill, a telescope, and a sky full of wonder.",
      },
      { property: "og:title", content: "ZENITH — The Celestial Eye" },
      {
        property: "og:description",
        content: "A cinematic opening to a journey through the night sky.",
      },
    ],
  }),
  component: Index,
});

type Star = { x: number; y: number; size: number; delay: number; duration: number };
type Firefly = { x: number; y: number; delay: number; duration: number; drift: number };

const TRANSITION_DURATION_MS = 1400;

interface IndexProps {
  onComplete?: () => void;
}

function Index({ onComplete }: IndexProps = {}) {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showGlobe, setShowGlobe] = useState(false);
  const isTransitioningRef = useRef(false);
  const [currentScreen, setCurrentScreen] = useState<'home' | 'zenith' | 'graveyard' | 'kessler'>('home');
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [isGlobeClickActive, setIsGlobeClickActive] = useState(false);
  const [selectedSpacecraftId, setSelectedSpacecraftId] = useState<string>("iss");
  const [spacecraftFocusTrigger, setSpacecraftFocusTrigger] = useState(0);
  const [selectedFeaturedObjectId, setSelectedFeaturedObjectId] = useState<string | null>(null);
  const [isKesslerTransitionComplete, setIsKesslerTransitionComplete] = useState(false);
  const [kesslerSimState, setKesslerSimState] = useState<KesslerSimState>('idle');
  const [kesslerSimMessage, setKesslerSimMessage] = useState<string>('');
  const [kesslerCountdown, setKesslerCountdown] = useState<number>(5);
  const [kesslerCollisionStartTime, setKesslerCollisionStartTime] = useState<number>(0);
  const [kesslerSecondaryCollisionStartTime, setKesslerSecondaryCollisionStartTime] = useState<number>(0);
  const [kesslerFinalCollisionStartTime, setKesslerFinalCollisionStartTime] = useState<number>(0);
  const [kesslerFinalHighlightStartTime, setKesslerFinalHighlightStartTime] = useState<number>(0);

  useEffect(() => {
    if (currentScreen === 'kessler') {
      setIsKesslerTransitionComplete(false);
      const timer = setTimeout(() => {
        setIsKesslerTransitionComplete(true);
      }, 2500);
      return () => clearTimeout(timer);
    } else {
      setIsKesslerTransitionComplete(false);
    }
  }, [currentScreen]);

  useEffect(() => {
    if (currentScreen !== 'kessler') {
      setKesslerSimState('idle');
      setKesslerSimMessage('');
      setKesslerCountdown(5);
      setKesslerCollisionStartTime(0);
      setKesslerSecondaryCollisionStartTime(0);
      setKesslerFinalCollisionStartTime(0);
      setKesslerFinalHighlightStartTime(0);
    }
  }, [currentScreen]);

  // Phase 5: secondary cascade after first debris cloud stabilizes
  useEffect(() => {
    if (kesslerSimState !== 'debris_drifting') return;

    const approachTimer = setTimeout(() => {
      setKesslerSecondaryCollisionStartTime(Date.now());
      setKesslerSimState('cascade_approach');
    }, CASCADE_SETTLE_MS);

    return () => clearTimeout(approachTimer);
  }, [kesslerSimState]);

  useEffect(() => {
    if (kesslerSimState !== 'cascade_approach') return;

    const impactTimer = setTimeout(() => {
      setKesslerSimState('cascade_impact');
    }, CASCADE_APPROACH_MS);

    return () => clearTimeout(impactTimer);
  }, [kesslerSimState]);

  useEffect(() => {
    if (kesslerSimState !== 'cascade_impact') return;

    const escalateTimer = setTimeout(() => {
      setKesslerSimState('cascade_escalating');
    }, CASCADE_IMPACT_MS);

    return () => clearTimeout(escalateTimer);
  }, [kesslerSimState]);

  // Phase 6: build-up after secondary collision stabilizes
  useEffect(() => {
    if (kesslerSimState !== 'cascade_escalating') return;

    const buildupTimer = setTimeout(() => {
      setKesslerFinalHighlightStartTime(Date.now());
      setKesslerSimState('final_highlight');
    }, FINAL_BUILDUP_MS);

    return () => clearTimeout(buildupTimer);
  }, [kesslerSimState]);

  useEffect(() => {
    if (kesslerSimState !== 'final_highlight') return;

    const approachTimer = setTimeout(() => {
      setKesslerFinalCollisionStartTime(Date.now());
      setKesslerSimState('final_approach');
    }, FINAL_HIGHLIGHT_DURATION_MS);

    return () => clearTimeout(approachTimer);
  }, [kesslerSimState]);

  useEffect(() => {
    if (kesslerSimState !== 'final_approach') return;

    const impactTimer = setTimeout(() => {
      setKesslerSimState('final_impact_1');
    }, FINAL_APPROACH_MS);

    return () => clearTimeout(impactTimer);
  }, [kesslerSimState]);

  useEffect(() => {
    if (kesslerSimState !== 'final_impact_1') return;

    const nextTimer = setTimeout(() => {
      setKesslerSimState('final_impact_2');
    }, FINAL_COLLISION_STAGGER_MS);

    return () => clearTimeout(nextTimer);
  }, [kesslerSimState]);

  useEffect(() => {
    if (kesslerSimState !== 'final_impact_2') return;

    const nextTimer = setTimeout(() => {
      setKesslerSimState('final_impact_3');
    }, FINAL_COLLISION_STAGGER_MS);

    return () => clearTimeout(nextTimer);
  }, [kesslerSimState]);

  useEffect(() => {
    if (kesslerSimState !== 'final_impact_3') return;

    const endTimer = setTimeout(() => {
      setKesslerSimState('kessler_cascade_active');
    }, CASCADE_IMPACT_MS);

    return () => clearTimeout(endTimer);
  }, [kesslerSimState]);

  useEffect(() => {
    if (kesslerSimState !== 'countdown') return;

    const interval = setInterval(() => {
      setKesslerCountdown((prev) => {
        if (prev <= 2) {
          clearInterval(interval);
          triggerCollisionSequence();
          return 1;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [kesslerSimState]);

  const triggerCollisionSequence = () => {
    setKesslerSimState('frozen');
    setKesslerCountdown(1);

    // 1.0 second freeze frame right before sequence start
    setTimeout(() => {
      setKesslerSimState('collision_sequence');
      const startTime = Date.now();
      setKesslerCollisionStartTime(startTime);

      // 0.5s pause + 1.5s approach = 2000ms until impact
      setTimeout(() => {
        setKesslerSimState('impact');

        // 800ms impact effects (flash + shake + shockwave)
        setTimeout(() => {
          setKesslerSimState('debris_drifting');
        }, 800);

      }, 2000);
    }, 1000);
  };

  const startKesslerSimulation = () => {
    if (kesslerSimState !== 'idle') return;
    setKesslerSimState('initializing');
    
    const messages = [
      "Initializing orbital environment...",
      "Loading orbital trajectories...",
      "Calculating collision probability...",
      "Locking collision prediction...",
      "Simulation initialized."
    ];

    setKesslerSimMessage(messages[0]);

    setTimeout(() => setKesslerSimMessage(messages[1]), 600);
    setTimeout(() => setKesslerSimMessage(messages[2]), 1200);
    setTimeout(() => setKesslerSimMessage(messages[3]), 1800);
    setTimeout(() => setKesslerSimMessage(messages[4]), 2400);

    setTimeout(() => {
      setKesslerSimState('countdown');
      setKesslerCountdown(5);
    }, 3000);
  };

  const handleSelectSpacecraft = (id: string, triggerFocus = false) => {
    setSelectedSpacecraftId(id);
    if (triggerFocus) {
      setSpacecraftFocusTrigger((prev) => prev + 1);
    }
  };

  // Sync ref with state to access inside the static schedule closure
  useEffect(() => {
    isTransitioningRef.current = isTransitioning;
  }, [isTransitioning]);



  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: 140 }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 75,
        size: Math.random() * 1.6 + 0.4,
        delay: Math.random() * 6,
        duration: Math.random() * 4 + 3,
      })),
    [],
  );

  const fireflies = useMemo<Firefly[]>(
    () =>
      Array.from({ length: 9 }, () => ({
        x: Math.random() * 100,
        y: 78 + Math.random() * 18,
        delay: Math.random() * 6,
        duration: Math.random() * 4 + 5,
        drift: (Math.random() - 0.5) * 30,
      })),
    [],
  );

  // Shooting stars: schedule a new one every few seconds
  const [shootingStars, setShootingStars] = useState<
    { id: number; top: number; left: number; angle: number; length: number; duration: number }[]
  >([]);

  useEffect(() => {
    let id = 0;
    let timer: number;
    const schedule = () => {
      const delay = 2500 + Math.random() * 4000;
      timer = window.setTimeout(() => {
        if (isTransitioningRef.current) {
          // Stop scheduling new shooting stars
          return;
        }
        const goingRight = Math.random() > 0.5;
        const next = {
          id: id++,
          top: 5 + Math.random() * 35,
          left: goingRight ? 5 + Math.random() * 30 : 60 + Math.random() * 30,
          angle: goingRight ? 18 + Math.random() * 20 : 160 - Math.random() * 20,
          length: 180 + Math.random() * 220,
          duration: 1.2 + Math.random() * 0.8,
        };
        setShootingStars((prev) => [...prev.slice(-2), next]);
        window.setTimeout(() => {
          setShootingStars((prev) => prev.filter((s) => s.id !== next.id));
        }, next.duration * 1000 + 200);
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);


  const handleSelectLocation = async (loc: { lat: number; lng: number; label?: string }) => {
    setIsGlobeClickActive(false);
    if (loc.label) {
      setSelectedLocation({
        lat: loc.lat,
        lng: loc.lng,
        label: loc.label,
      });
    } else {
      // Set temporary state to show immediate coordinate tracking feedback
      setSelectedLocation({
        lat: loc.lat,
        lng: loc.lng,
        label: "Geocoding location...",
      });

      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lng}&format=json`,
          {
            headers: {
              "User-Agent": "CelestialEyeOpener/1.0 (Zenith Sky Explorer)",
            },
          }
        );
        if (!response.ok) throw new Error("Network response error");
        const data = await response.json();
        
        const address = data.address || {};
        const placeName = address.city || address.town || address.village || address.county || address.state || address.region || address.ocean || address.sea;
        const country = address.country;
        
        let cleanLabel = "";
        if (placeName && country) {
          cleanLabel = `${placeName}, ${country}`;
        } else if (placeName) {
          cleanLabel = placeName;
        } else if (country) {
          cleanLabel = country;
        } else if (data.display_name) {
          const parts = data.display_name.split(",");
          cleanLabel = parts.length >= 2 ? `${parts[0].trim()}, ${parts[parts.length - 1].trim()}` : parts[0].trim();
        }

        if (!cleanLabel) {
          const latStr = `${Math.abs(loc.lat).toFixed(2)}° ${loc.lat >= 0 ? "N" : "S"}`;
          const lngStr = `${Math.abs(loc.lng).toFixed(2)}° ${loc.lng >= 0 ? "E" : "W"}`;
          cleanLabel = `Coordinates: ${latStr}, ${lngStr}`;
        }

        setSelectedLocation({
          lat: loc.lat,
          lng: loc.lng,
          label: cleanLabel,
        });
      } catch (err) {
        console.warn("Geocoding lookup failed:", err);
        const latStr = `${Math.abs(loc.lat).toFixed(2)}° ${loc.lat >= 0 ? "N" : "S"}`;
        const lngStr = `${Math.abs(loc.lng).toFixed(2)}° ${loc.lng >= 0 ? "E" : "W"}`;
        setSelectedLocation({
          lat: loc.lat,
          lng: loc.lng,
          label: `Coordinates: ${latStr}, ${lngStr}`,
        });
      }
    }
  };

  const handleStartTransition = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    setTimeout(() => {
      setShowGlobe(true);
      onComplete?.();
    }, TRANSITION_DURATION_MS);
  };

  return (
    <>
      <main 
        className={`hero-scene${isTransitioning ? " transitioning" : ""}`}
        onClick={handleStartTransition}
      >
        <img
          src={heroImage}
          alt="Two children gazing up at a star-filled night sky beside a telescope on a grassy hill"
          className="hero-image"
          width={1920}
          height={1088}
        />
        <div className="hero-vignette" aria-hidden="true" />

        {/* Starfield Container for Zoom Transition */}
        <div className="starfield-container" aria-hidden="true">
          {/* Twinkling stars */}
          <div className="star-layer">
            {stars.map((s, i) => (
              <span
                key={i}
                className="star"
                style={{
                  left: `${s.x}%`,
                  top: `${s.y}%`,
                  width: `${s.size}px`,
                  height: `${s.size}px`,
                  animationDelay: `${s.delay}s`,
                  animationDuration: `${s.duration}s`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Shooting stars */}
        <div className="shooting-layer" aria-hidden="true">
          {shootingStars.map((s) => (
            <span
              key={s.id}
              className="shooting-star"
              style={
                {
                  top: `${s.top}%`,
                  left: `${s.left}%`,
                  width: `${s.length}px`,
                  animationDuration: `${s.duration}s`,
                  ["--angle" as never]: `${s.angle}deg`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>

        {/* Fireflies + grass shimmer */}
        <div className="firefly-layer" aria-hidden="true">
          {fireflies.map((f, i) => (
            <span
              key={i}
              className="firefly"
              style={
                {
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  animationDelay: `${f.delay}s`,
                  animationDuration: `${f.duration}s`,
                  ["--drift" as never]: `${f.drift}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>

        {/* Grass breeze overlay — subtle horizontal sway of foreground */}
        <div className="grass-breeze" aria-hidden="true" />

        {/* UI */}
        <header className="hero-brand">
          <h1 className="brand-title">ZENITH</h1>
          <p className="brand-sub">The Celestial Eye</p>
        </header>

        <footer className="hero-cta">
          <span className="cta-text">Click to explore</span>
          <span className="cta-chevron" aria-hidden="true" />
        </footer>
      </main>

      <div className={`globe-view-container${showGlobe ? " visible" : ""}`}>
        {(isTransitioning || showGlobe) && (
          <>
            <GlobeView 
              active={showGlobe} 
              targetLocation={selectedLocation} 
              onSelectLocation={isGlobeClickActive ? handleSelectLocation : undefined} 
              selectedSpacecraftId={selectedSpacecraftId}
              spacecraftFocusTrigger={spacecraftFocusTrigger}
              onSelectSpacecraft={handleSelectSpacecraft}
              isGraveyard={currentScreen === 'graveyard'}
              selectedFeaturedObjectId={selectedFeaturedObjectId}
              onSelectFeaturedObject={setSelectedFeaturedObjectId}
              isKessler={currentScreen === 'kessler'}
              kesslerSimState={kesslerSimState}
              kesslerCountdown={kesslerCountdown}
              kesslerCollisionStartTime={kesslerCollisionStartTime}
              kesslerSecondaryCollisionStartTime={kesslerSecondaryCollisionStartTime}
              kesslerFinalCollisionStartTime={kesslerFinalCollisionStartTime}
              kesslerFinalHighlightStartTime={kesslerFinalHighlightStartTime}
            />
            <NavigationPanel 
              active={showGlobe && currentScreen === 'home'} 
              onSelectFeature={(feat) => {
                if (feat === 'zenith') setCurrentScreen('zenith');
                if (feat === 'graveyard') setCurrentScreen('graveyard');
                if (feat === 'kessler') setCurrentScreen('kessler');
              }}
            />
            <ZenithLocationPanel 
              active={showGlobe && currentScreen === 'zenith'}
              selectedLocation={selectedLocation}
              isGlobeClickActive={isGlobeClickActive}
              setIsGlobeClickActive={setIsGlobeClickActive}
              onBack={() => {
                setCurrentScreen('home');
                setSelectedLocation(null);
                setIsGlobeClickActive(false);
              }}
              onSelectLocation={(loc) => handleSelectLocation(loc)}
            />
            <ZenithIntelligencePanel 
              active={showGlobe && currentScreen === 'zenith' && selectedLocation !== null}
              selectedLocation={selectedLocation}
              selectedSpacecraftId={selectedSpacecraftId}
              onSelectSpacecraft={handleSelectSpacecraft}
            />
            <GraveyardIntroPanel 
              active={showGlobe && currentScreen === 'graveyard'}
              onBack={() => {
                setCurrentScreen('home');
                setSelectedFeaturedObjectId(null);
              }}
            />
            <GraveyardIntelligencePanel
              active={showGlobe && currentScreen === 'graveyard' && selectedFeaturedObjectId !== null}
              objectId={selectedFeaturedObjectId}
              onClose={() => setSelectedFeaturedObjectId(null)}
            />
            <KesslerIntroPanel 
              active={showGlobe && currentScreen === 'kessler' && isKesslerTransitionComplete}
              onBack={() => {
                setCurrentScreen('home');
              }}
              simState={kesslerSimState}
              simMessage={kesslerSimMessage}
              simCountdown={kesslerCountdown}
              onStartSim={startKesslerSimulation}
            />
          </>
        )}
      </div>
    </>
  );
}
