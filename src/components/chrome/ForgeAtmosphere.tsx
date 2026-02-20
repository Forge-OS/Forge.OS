export function ForgeAtmosphere() {
  return (
    <div className="forge-atmosphere" aria-hidden="true">
      <div className="forge-atmosphere__aura forge-atmosphere__aura--north" />
      <div className="forge-atmosphere__aura forge-atmosphere__aura--east" />
      <div className="forge-atmosphere__aura forge-atmosphere__aura--south" />
      <div className="forge-atmosphere__grid" />
      <div className="forge-atmosphere__rings">
        <span className="forge-ring forge-ring--one" />
        <span className="forge-ring forge-ring--two" />
        <span className="forge-ring forge-ring--three" />
      </div>
      <div className="forge-atmosphere__blips">
        <span className="forge-blip forge-blip--a" />
        <span className="forge-blip forge-blip--b" />
        <span className="forge-blip forge-blip--c" />
      </div>
    </div>
  );
}
