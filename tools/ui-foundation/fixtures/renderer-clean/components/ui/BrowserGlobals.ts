// window.hxbot belongs in the application adapter.
export const documentation = "window.hxbot";
export const viewport = () => window.innerWidth;
export const platformAction = (props: { hxbot: () => void }) => props.hxbot();
