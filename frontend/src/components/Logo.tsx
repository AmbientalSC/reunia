import React from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";
import { AmbientalLogo } from "./AmbientalLogo";

interface LogoProps {
    isCollapsed: boolean;
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(({ isCollapsed }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      {isCollapsed ? (
        <DialogTrigger asChild>
          <button ref={ref} className="flex items-center justify-start mb-2 cursor-pointer bg-transparent border-none p-0 hover:opacity-80 transition-opacity">
            <AmbientalLogo size={36} />
          </button>
        </DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <span className="flex items-center gap-2 text-center border rounded-full bg-ambiental-blue-soft border-ambiental-blue-soft font-semibold text-ambiental-blue mb-2 px-4 py-1.5 block cursor-pointer hover:opacity-80 transition-opacity">
            <AmbientalLogo size={22} />
            <span>ReunIA</span>
          </span>
        </DialogTrigger>
      )}
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>Sobre o ReunIA</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Logo.displayName = "Logo";

export default Logo;