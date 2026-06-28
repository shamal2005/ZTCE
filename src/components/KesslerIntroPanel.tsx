import { ArrowLeft, Cpu, Activity, Play, BarChart2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type KesslerSimState } from "../types/kessler";

interface KesslerIntroPanelProps {
  active?: boolean;
  onBack?: () => void;
  simState?: KesslerSimState;
  simMessage?: string;
  simCountdown?: number;
  onStartSim?: () => void;
}

function AnimatedNumber({ value, duration = 900 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t * t * (3 - 2 * t);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  return <>{display}</>;
}

function getSnapshotValues(simState: KesslerSimState) {
  switch (simState) {
    case 'debris_drifting':
      return { satellites: 18, debris: 45, collisions: 'Monitoring', events: 1 };
    case 'cascade_approach':
    case 'cascade_impact':
      return { satellites: 18, debris: 45, collisions: 'Monitoring', events: 1 };
    case 'cascade_escalating':
      return { satellites: 17, debris: 70, collisions: 'High Risk', events: 2 };
    default:
      return { satellites: 20, debris: 0, collisions: simState === 'idle' || simState === 'initializing' ? '0' : '1', events: 0 };
  }
}

export default function KesslerIntroPanel({
  active = false,
  onBack,
  simState = 'idle',
  simMessage = '',
  simCountdown = 5,
  onStartSim,
}: KesslerIntroPanelProps) {
  const snapshot = getSnapshotValues(simState);
  const isCascadePhase = simState === 'cascade_approach' || simState === 'cascade_impact' || simState === 'cascade_escalating';

  return (
    <div
      className={`fixed left-6 md:left-8 top-4 md:top-5 z-50 flex flex-col w-[250px] md:w-[280px] h-[calc(100vh-2.5rem)] select-none font-inter transition-all duration-1000 ease-out transform ${
        active ? "opacity-100 translate-x-0 pointer-events-auto" : "opacity-0 -translate-x-12 pointer-events-none"
      }`}
    >
      {/* Top Header Section */}
      <header className="flex flex-col select-none mb-6 flex-shrink-0">
        <button
          onClick={onBack}
          className="group flex items-center gap-1.5 text-purple-500 hover:text-purple-400 font-inter text-[10px] font-bold uppercase tracking-[0.2em] mb-4 outline-none border-none bg-transparent self-start cursor-pointer transition-colors duration-300"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform duration-300" />
          Back
        </button>
        <h2 className="text-[20px] md:text-[23px] font-bold font-inter tracking-[0.25em] text-white uppercase drop-shadow-[0_0_12px_rgba(168,85,247,0.25)]">
          KESSLER SIMULATION
        </h2>
        <p className="text-[8.5px] md:text-[9.5px] font-semibold font-inter tracking-[0.2em] text-purple-400/80 uppercase mt-2">
          Orbital Collision Cascade Simulator
        </p>
      </header>

      {/* Main Cards Menu container */}
      <div className="flex-1 overflow-y-auto pr-1.5 flex flex-col gap-4 scrollbar-none pb-4">
        {/* Card 1 — KESSLER SYNDROME */}
        <div className="kessler-card flex flex-col gap-3">
          <div className="flex items-center gap-2 border-b border-purple-500/15 pb-2">
            <Cpu className="w-4 h-4 text-purple-400" />
            <span className="text-[10px] md:text-[11px] font-bold font-inter tracking-[0.12em] text-slate-200 uppercase">
              Kessler Syndrome
            </span>
          </div>
          <p className="text-[9.5px] md:text-[10.5px] text-slate-300 leading-relaxed font-inter font-normal">
            Kessler Syndrome describes a cascading chain reaction in which collisions between satellites and orbital debris generate increasingly more debris, dramatically raising the probability of future collisions. Even a single impact can threaten the long-term sustainability of Earth's orbital environment.
          </p>
        </div>

        {/* Card 2 — SIMULATION STATUS */}
        <div 
          className={`kessler-card flex flex-col gap-3 border transition-colors duration-500 ${
            simState === 'initializing' ? "border-amber-500/25 bg-amber-950/5" :
            simState === 'countdown' ? "border-rose-500/25 bg-rose-950/5" :
            simState === 'frozen' ? "border-red-500/30 bg-red-950/10" :
            simState === 'collision_sequence' || simState === 'impact' ? "border-orange-500/25 bg-orange-950/5" :
            simState === 'debris_drifting' ? "border-red-500/40 bg-red-950/15" :
            simState === 'cascade_approach' ? "border-orange-500/30 bg-orange-950/10" :
            simState === 'cascade_impact' ? "border-orange-500/40 bg-orange-950/15" :
            simState === 'cascade_escalating' ? "border-red-500/50 bg-red-950/20" :
            "border-emerald-500/20 bg-emerald-950/5"
          }`}
        >
          <div className="flex items-center justify-between border-b border-purple-500/15 pb-2">
            <div className="flex items-center gap-2">
              <Activity className={`w-4 h-4 transition-colors duration-500 ${
                simState === 'initializing' ? "text-amber-400" :
                simState === 'countdown' ? "text-rose-400 animate-pulse" :
                simState === 'frozen' ? "text-red-400" :
                simState === 'collision_sequence' || simState === 'impact' ? "text-orange-400 animate-pulse" :
                simState === 'debris_drifting' ? "text-red-400 animate-pulse" :
                simState === 'cascade_approach' ? "text-orange-400 animate-pulse" :
                simState === 'cascade_impact' ? "text-orange-500 animate-pulse" :
                simState === 'cascade_escalating' ? "text-red-500 animate-pulse" :
                "text-emerald-400"
              }`} />
              <span className="text-[10px] md:text-[11px] font-bold font-inter tracking-[0.12em] text-slate-200 uppercase">
                Simulation Status
              </span>
            </div>

            {/* Dynamic Status Badge */}
            {simState === 'idle' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] md:text-[10px] font-bold text-emerald-400 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                READY
              </span>
            )}
            {simState === 'initializing' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[9px] md:text-[10px] font-bold text-amber-400 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                INITIALIZING
              </span>
            )}
            {simState === 'countdown' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-[9px] md:text-[10px] font-bold text-rose-400 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                ACTIVE
              </span>
            )}
            {simState === 'frozen' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-[9px] md:text-[10px] font-bold text-red-400 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                HALTED
              </span>
            )}
            {(simState === 'collision_sequence' || simState === 'impact') && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-[9px] md:text-[10px] font-bold text-orange-400 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                COLLIDING
              </span>
            )}
            {simState === 'debris_drifting' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/35 text-[9px] md:text-[10px] font-bold text-red-400 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
                COLLISION DETECTED
              </span>
            )}
            {simState === 'cascade_approach' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-[9px] md:text-[10px] font-bold text-orange-400 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                CASCADE DETECTED
              </span>
            )}
            {simState === 'cascade_impact' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-orange-500/20 border border-orange-500/40 text-[9px] md:text-[10px] font-bold text-orange-500 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping" />
                SECONDARY IMPACT
              </span>
            )}
            {simState === 'cascade_escalating' && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-[9px] md:text-[10px] font-bold text-red-500 tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                CASCADE ESCALATING
              </span>
            )}
          </div>

          {/* Dynamic Status Text */}
          <div className="text-[9.5px] md:text-[10.5px] text-slate-300 leading-relaxed font-inter font-normal min-h-[64px]">
            {simState === 'idle' && (
              <p>
                The orbital environment is currently stable.
                <br />
                Twenty satellites are being actively monitored.
                <br />
                No collision events have been detected.
                <br />
                <br />
                Press Start Simulation to initiate the collision cascade scenario.
              </p>
            )}
            {simState === 'initializing' && (
              <p key={simMessage} className="animate-pulse text-amber-300/90 font-medium">
                {simMessage}
              </p>
            )}
            {simState === 'countdown' && (
              <p>
                Simulation initialized.
                <br />
                Potential orbital intersection detected.
                <br />
                Monitoring imminent collision pair...
              </p>
            )}
            {simState === 'frozen' && (
              <p className="text-red-300/90 font-medium">
                Simulation paused.
                <br />
                Imminent collision event locked.
                <br />
                Awaiting impact trigger.
              </p>
            )}
            {(simState === 'collision_sequence' || simState === 'impact') && (
              <p className="text-orange-300/90 font-medium">
                Potential orbital intersection locked.
                <br />
                Collision course imminent.
                <br />
                Approaching impact coordinate...
              </p>
            )}
            {simState === 'debris_drifting' && (
              <p className="text-red-300/90 font-medium">
                Initial orbital collision confirmed.
                <br />
                A debris cloud has been generated.
                <br />
                Monitoring the surrounding orbital environment for potential secondary impacts.
              </p>
            )}
            {simState === 'cascade_approach' && (
              <p className="text-orange-300/90 font-medium">
                Dangerous debris fragment identified within the initial collision cloud.
                <br />
                Secondary collision trajectory detected.
                <br />
                Operational satellite convergence in progress...
              </p>
            )}
            {simState === 'cascade_impact' && (
              <p className="text-orange-300/90 font-medium">
                Secondary orbital collision in progress.
                <br />
                Debris fragment impact confirmed.
                <br />
                Generating secondary debris cloud...
              </p>
            )}
            {simState === 'cascade_escalating' && (
              <p className="text-red-300/90 font-medium">
                A debris fragment from the initial collision has destroyed another operational satellite.
                <br />
                <br />
                The orbital environment is becoming increasingly unstable as debris density continues to rise.
              </p>
            )}
          </div>
        </div>

        {/* Card 3 — ENVIRONMENT SNAPSHOT */}
        <div className="kessler-card flex flex-col gap-3">
          <div className="flex items-center gap-2 border-b border-purple-500/15 pb-2">
            <BarChart2 className="w-4 h-4 text-purple-400" />
            <span className="text-[10px] md:text-[11px] font-bold font-inter tracking-[0.12em] text-slate-200 uppercase">
              Environment Snapshot
            </span>
          </div>
          <div className="flex flex-col gap-3 text-[10px] md:text-[11px] font-inter">
            <div className="flex justify-between items-center py-0.5 border-b border-purple-500/5">
              <span className="text-slate-400 font-normal">Active Satellites</span>
              <span className="text-slate-100 font-bold text-[13px] md:text-[14px] transition-all duration-300">
                <AnimatedNumber value={snapshot.satellites} />
              </span>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-purple-500/5">
              <span className="text-slate-400 font-normal">Debris Objects</span>
              <span className="text-slate-100 font-bold text-[13px] md:text-[14px] transition-all duration-300">
                <AnimatedNumber value={snapshot.debris} />
              </span>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-purple-500/5">
              <span className="text-slate-400 font-normal">Predicted Collisions</span>
              <span className={`font-bold text-[13px] md:text-[14px] transition-all duration-500 ${
                snapshot.collisions === 'High Risk' ? 'text-red-400' : 'text-slate-100'
              }`}>
                {typeof snapshot.collisions === 'number' ? (
                  <AnimatedNumber value={snapshot.collisions} />
                ) : (
                  snapshot.collisions
                )}
              </span>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-purple-500/5">
              <span className="text-slate-400 font-normal">Collision Events</span>
              <span className="text-slate-100 font-bold text-[13px] md:text-[14px] transition-all duration-300">
                <AnimatedNumber value={snapshot.events} />
              </span>
            </div>
            <div className="flex justify-between items-center py-0.5">
              <span className="text-slate-400 font-normal">Simulation State</span>
              <span className={`font-bold uppercase tracking-wider text-[9px] md:text-[10px] transition-colors duration-500 ${
                simState === 'initializing' ? "text-amber-400" :
                simState === 'countdown' ? "text-rose-400" :
                simState === 'frozen' ? "text-red-400" :
                simState === 'collision_sequence' || simState === 'impact' ? "text-orange-400 animate-pulse" :
                simState === 'debris_drifting' ? "text-red-400 animate-pulse" :
                simState === 'cascade_approach' || simState === 'cascade_impact' ? "text-orange-400 animate-pulse" :
                simState === 'cascade_escalating' ? "text-red-500 animate-pulse" :
                "text-purple-400"
              }`}>
                {simState === 'idle' && 'Standby'}
                {simState === 'initializing' && 'Initializing'}
                {simState === 'countdown' && 'Countdown'}
                {simState === 'frozen' && 'LOCKED'}
                {simState === 'collision_sequence' && 'Intercepting'}
                {simState === 'impact' && 'Impact'}
                {simState === 'debris_drifting' && 'Collision Detected'}
                {simState === 'cascade_approach' && 'Cascade Detected'}
                {simState === 'cascade_impact' && 'Secondary Impact'}
                {simState === 'cascade_escalating' && 'Cascade Escalating'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Start Simulation Button */}
      <div className="mt-auto pt-4 flex-shrink-0">
        <button
          onClick={simState === 'idle' ? onStartSim : undefined}
          disabled={simState !== 'idle'}
          className={`w-full relative group overflow-hidden rounded-xl border px-4 py-3 md:py-3.5 text-center font-inter text-xs md:text-sm font-bold uppercase tracking-[0.15em] transition-all duration-300 ${
            simState === 'idle'
              ? "border-purple-500/30 bg-gradient-to-r from-purple-950/20 via-fuchsia-950/20 to-rose-950/20 text-white shadow-[0_0_15px_rgba(168,85,247,0.15)] hover:border-purple-400/50 hover:shadow-[0_0_25px_rgba(168,85,247,0.3)] active:scale-[0.98] active:opacity-90 cursor-pointer"
              : simState === 'debris_drifting' || isCascadePhase
              ? "border-red-500/10 bg-red-950/20 text-red-500 opacity-60 cursor-not-allowed"
              : "border-slate-500/10 bg-slate-950/20 text-slate-500 opacity-60 cursor-not-allowed"
          }`}
        >
          {/* Subtle background glow on hover */}
          {simState === 'idle' && (
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          )}
          <span className="relative z-10 flex items-center justify-center gap-2">
            {simState === 'idle' && (
              <>
                <Play className="w-3.5 h-3.5 text-purple-400 fill-purple-400/30" />
                <span>Start Simulation</span>
              </>
            )}
            {simState === 'initializing' && (
              <>
                <span className="w-2.5 h-2.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                <span>Initializing Simulation...</span>
              </>
            )}
            {simState === 'countdown' && (
              <>
                <Activity className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                <span>Simulation Running</span>
              </>
            )}
            {simState === 'frozen' && (
              <>
                <Activity className="w-3.5 h-3.5 text-red-500" />
                <span>Simulation Halted</span>
              </>
            )}
            {(simState === 'collision_sequence' || simState === 'impact') && (
              <>
                <Activity className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
                <span>Intercepting...</span>
              </>
            )}
            {simState === 'debris_drifting' && (
              <>
                <Activity className="w-3.5 h-3.5 text-red-500" />
                <span>Collision Detected</span>
              </>
            )}
            {simState === 'cascade_approach' && (
              <>
                <Activity className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
                <span>Cascade Detected</span>
              </>
            )}
            {simState === 'cascade_impact' && (
              <>
                <Activity className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                <span>Secondary Impact</span>
              </>
            )}
            {simState === 'cascade_escalating' && (
              <>
                <Activity className="w-3.5 h-3.5 text-red-500 animate-pulse" />
                <span>Cascade Escalating</span>
              </>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}
