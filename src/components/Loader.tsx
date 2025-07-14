import { motion } from 'framer-motion';

export default function Loader({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8" role="status" aria-live="polite">
      <motion.div
        className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-2"
        aria-hidden="true"
        initial={{ rotate: 0 }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
      />
      <span className="text-sm text-gray-500 dark:text-gray-300">{label}</span>
    </div>
  );
}
