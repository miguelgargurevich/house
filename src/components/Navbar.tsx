
import { BuildingOffice2Icon, Bars3Icon } from '@heroicons/react/24/outline';
import ThemeToggle from './ThemeToggle';

export default function Navbar() {

  return (
    <nav className="h-16 bg-primary dark:bg-gray-800 text-white flex items-center px-4 md:px-6 shadow justify-between transition-colors">
      <span className="font-bold text-lg tracking-wide flex items-center gap-2">
        <BuildingOffice2Icon className="h-7 w-7" /> House
      </span>
      <div className="flex items-center gap-2">
        {/* Menú hamburguesa solo visible en mobile */}
        <button
          type="button"
          className="block md:hidden p-2 rounded hover:bg-white/10 focus:outline-none"
          aria-label="Abrir menú"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('toggle-sidebar'));
          }}
        >
          <Bars3Icon className="h-6 w-6" />
        </button>
        <ThemeToggle />
      </div>
    </nav>
  );
}
