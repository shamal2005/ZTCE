import { Telescope, Skull, Orbit, ChevronRight, Compass } from "lucide-react";

interface NavigationPanelProps {
  active?: boolean;
  onSelectFeature?: (feature: 'zenith' | 'graveyard' | 'kessler') => void;
}

export default function NavigationPanel({ active = false, onSelectFeature }: NavigationPanelProps) {
  return (
    <>
      {/* Top Header Section */}
      <header
        className={`fixed left-6 md:left-8 top-6 md:top-8 z-50 flex flex-col pointer-events-none select-none antialiased transition-all duration-1000 ease-out transform ${
          active ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-6"
        }`}
        style={{ transitionDelay: "100ms" }}
      >
        <h2 className="text-[26px] md:text-[32px] font-extrabold font-inter uppercase tracking-[0.14em] text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.15)]">
          ZENITH
        </h2>
        <p className="text-[10px] md:text-[11px] font-normal font-inter tracking-[0.01em] text-slate-300/90 leading-relaxed mt-1.5">
          Visualizing Earth's orbital environment
        </p>
      </header>

      <div
        className={`fixed left-6 md:left-8 z-50 flex flex-col justify-between w-[240px] md:w-[260px] h-[80vh] max-h-[600px] select-none font-inter antialiased transition-all duration-1000 ${
          active ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        style={{ top: "calc(50% + 50px)", transform: "translateY(-50%)" }}
      >

      {/* Feature Cards Section */}
      <div className="flex flex-col gap-4 my-auto">
        {/* Card 1: Zenith View */}
        <div
          onClick={() => onSelectFeature?.('zenith')}
          className={`group feature-card-base feature-card-zenith transform ${
            active ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-12"
          }`}
          style={{ transitionDelay: "300ms" }}
        >
          {/* Left Icon Wrapper */}
          <div className="flex items-center justify-center w-11 h-11 rounded-full border border-blue-500/20 bg-blue-500/10 shadow-[0_0_8px_rgba(59,130,246,0.1)] group-hover:scale-105 group-hover:border-blue-400/40 group-hover:shadow-[0_0_12px_rgba(59,130,246,0.2)] transition-all duration-300 flex-shrink-0 z-10">
            <Telescope className="w-5 h-5 text-blue-400 group-hover:text-blue-300 transition-colors duration-300" />
          </div>

          {/* Text Content */}
          <div className="flex-1 ml-3 pr-1 z-10">
            <h3 className="text-[11px] md:text-[13px] font-bold font-inter uppercase tracking-[0.1em] text-slate-100 mb-0.5 group-hover:text-white transition-colors duration-300">
              Zenith View
            </h3>
            <p className="text-[10px] md:text-[11px] font-medium font-inter text-slate-300/70 leading-relaxed">
              See the sky above any location in real time
            </p>
          </div>

          {/* Right Chevron */}
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-300 flex-shrink-0 z-10" />
        </div>

        {/* Card 2: Graveyard Mode */}
        <div
          onClick={() => onSelectFeature?.('graveyard')}
          className={`group feature-card-base feature-card-graveyard transform ${
            active ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-12"
          }`}
          style={{ transitionDelay: "450ms" }}
        >
          {/* Left Icon Wrapper */}
          <div className="flex items-center justify-center w-11 h-11 rounded-full border border-red-500/20 bg-red-500/10 shadow-[0_0_8px_rgba(239,68,68,0.1)] group-hover:scale-105 group-hover:border-red-400/40 group-hover:shadow-[0_0_12px_rgba(239,68,68,0.2)] transition-all duration-300 flex-shrink-0 z-10">
            <Skull className="w-5 h-5 text-red-400 group-hover:text-red-300 transition-colors duration-300" />
          </div>

          {/* Text Content */}
          <div className="flex-1 ml-3 pr-1 z-10">
            <h3 className="text-[11px] md:text-[13px] font-bold font-inter uppercase tracking-[0.1em] text-slate-100 mb-0.5 group-hover:text-white transition-colors duration-300">
              Graveyard Mode
            </h3>
            <p className="text-[10px] md:text-[11px] font-medium font-inter text-slate-300/70 leading-relaxed">
              Discover inactive satellites and orbital debris
            </p>
          </div>

          {/* Right Chevron */}
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-300 flex-shrink-0 z-10" />
        </div>

        {/* Card 3: Kessler Simulation */}
        <div
          onClick={() => onSelectFeature?.('kessler')}
          className={`group feature-card-base feature-card-kessler transform ${
            active ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-12"
          }`}
          style={{ transitionDelay: "600ms" }}
        >
          {/* Left Icon Wrapper */}
          <div className="flex items-center justify-center w-11 h-11 rounded-full border border-purple-500/20 bg-purple-500/10 shadow-[0_0_8px_rgba(168,85,247,0.1)] group-hover:scale-105 group-hover:border-purple-400/40 group-hover:shadow-[0_0_12px_rgba(168,85,247,0.2)] transition-all duration-300 flex-shrink-0 z-10">
            <Orbit className="w-5 h-5 text-purple-400 group-hover:text-purple-300 transition-colors duration-300" />
          </div>

          {/* Text Content */}
          <div className="flex-1 ml-3 pr-1 z-10">
            <h3 className="text-[11px] md:text-[13px] font-bold font-inter uppercase tracking-[0.1em] text-slate-100 mb-0.5 group-hover:text-white transition-colors duration-300">
              Kessler Simulation
            </h3>
            <p className="text-[10px] md:text-[11px] font-medium font-inter text-slate-300/70 leading-relaxed">
              Simulate cascading orbital collisions
            </p>
          </div>

          {/* Right Chevron */}
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-300 flex-shrink-0 z-10" />
        </div>
      </div>

      {/* Bottom Footer Section */}
      <footer
        className={`flex items-start gap-2.5 transition-all duration-1000 ease-out transform ${
          active ? "opacity-50 translate-y-0" : "opacity-0 translate-y-6"
        }`}
        style={{ transitionDelay: "750ms" }}
      >
        <Compass className="w-4.5 h-4.5 text-slate-400/80 mt-0.5 flex-shrink-0" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[8px] md:text-[9px] font-normal font-inter uppercase tracking-[0.16em] text-slate-200">
            Explore. Understand. Protect.
          </span>
          <span className="text-[8px] md:text-[9px] font-light font-inter tracking-[0.02em] text-slate-400/85 leading-relaxed">
            Our orbital future depends on it.
          </span>
        </div>
      </footer>
    </div>
    </>
  );
}
