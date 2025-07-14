import { UserIcon } from '@heroicons/react/24/solid';

export default function Avatar({ src, alt = 'Avatar', size = 40 }: { src?: string; alt?: string; size?: number }) {
  return src ? (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="rounded-full object-cover border border-gray-200 dark:border-gray-700"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="inline-flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
      style={{ width: size, height: size }}
      aria-label={alt}
    >
      <UserIcon className="h-2/3 w-2/3" />
    </span>
  );
}
