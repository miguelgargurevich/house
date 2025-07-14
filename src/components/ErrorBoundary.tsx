import { Component } from 'react';
import type { ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  // Puedes loguear el error a un servicio externo aquí
  // componentDidCatch(error: any, info: any) {}

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-8 text-center text-red-600 dark:text-red-400">
          <h2 className="text-xl font-bold mb-2">¡Ha ocurrido un error inesperado!</h2>
          <p className="mb-2">Por favor, recarga la página o contacta soporte.</p>
          <pre className="text-xs text-red-400 dark:text-red-300 bg-red-50 dark:bg-gray-900 rounded p-2 overflow-x-auto max-w-xl mx-auto">
            {String(this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
