import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useApi } from '../hooks/useApi';
import { motion } from 'framer-motion';

// Removed unused User type

interface LoginForm {
  email: string;
  password: string;
}

const testimonios: { nombre: string; empresa: string; texto: string; }[] = [
  {
    nombre: 'Ana López',
    empresa: 'Gestión Urbana',
    texto: 'House nos permitió automatizar la gestión de recibos y pagos. ¡Ahorro de tiempo y cero errores!'
  },
  {
    nombre: 'Carlos Rivas',
    empresa: 'Edifica Perú',
    texto: 'La administración de condominios nunca fue tan fácil. El soporte y la seguridad son excelentes.'
  },
  {
    nombre: 'Sofía Ramírez',
    empresa: 'Propietaria',
    texto: 'Puedo ver mis recibos y comunicarme con la administración desde cualquier lugar. ¡Recomendado!'
  },
  {
    nombre: 'Jorge Medina',
    empresa: 'Condominios Modernos',
    texto: 'La integración con IA nos ayuda a resolver dudas rápidamente. El sistema es muy intuitivo.'
  },
  {
    nombre: 'Laura Gutiérrez',
    empresa: 'Gestión Urbana',
    texto: 'La experiencia mobile y la accesibilidad son perfectas para nuestro equipo.'
  },
  {
    nombre: 'Pedro Sánchez',
    empresa: 'Seguridad Urbana',
    texto: 'La gestión de accesos y reportes de seguridad es mucho más eficiente con House.'
  },
  {
    nombre: 'María Fernández',
    empresa: 'Mantenimiento Urbano',
    texto: 'El sistema nos ayuda a programar y controlar todas las tareas de mantenimiento sin perder nada.'
  },
  {
    nombre: 'Javier Castro',
    empresa: 'Propietario',
    texto: 'Me encanta poder pagar mis recibos y ver el historial desde el móvil, ¡muy fácil!'
  },
  {
    nombre: 'Valentina Ruiz',
    empresa: 'Inquilina',
    texto: 'La comunicación con la administración y el soporte son excelentes. ¡Muy recomendable!'
  },
  {
    nombre: 'Alfredo Díaz',
    empresa: 'Edifica Perú',
    texto: 'La migración de datos fue sencilla y el equipo de soporte nos acompañó en todo momento.'
  },
  {
    nombre: 'Andrea Salazar',
    empresa: 'Residenciales del Sur',
    texto: 'La plataforma es intuitiva y el acceso multi-rol facilita la gestión de grandes condominios.'
  },
  {
    nombre: 'Lucas Bravo',
    empresa: 'Inquilino',
    texto: 'Nunca fue tan fácil reportar incidencias y recibir respuestas rápidas.'
  },
  {
    nombre: 'Emilia Torres',
    empresa: 'Propietaria',
    texto: 'La transparencia en la gestión y los reportes automáticos nos dan mucha confianza.'
  }
];

import { useEffect } from 'react';

function MarquesinaTestimonios() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setIndex(i => (i + 1) % testimonios.length);
    }, 10000);
    return () => clearTimeout(timer);
  }, [index]);
  const t = testimonios[index];
  return (
    <motion.div
      key={index}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
      className="flex flex-col gap-8"
    >
      <div
        className="bg-white/80 dark:bg-gray-900/80 rounded-xl shadow-lg border border-primary/10 px-6 py-6 flex flex-col items-center text-center backdrop-blur-md"
        style={{ minHeight: 110 }}
      >
        <div className="text-lg font-bold text-primary dark:text-accent mb-1">{t.nombre} <span className="text-xs font-normal text-gray-500 dark:text-gray-300">({t.empresa})</span></div>
        <div className="text-base text-gray-700 dark:text-gray-200 italic">“{t.texto}”</div>
      </div>
    </motion.div>
  );
}


function LoginPage() {
  const { apiFetch, setToken } = useApi();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      // Llama al endpoint de login (ajusta la ruta si es necesario)
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (res.token) {
        setToken(res.token);
        navigate('/'); // Redirige al home o dashboard
      } else {
        setError('Credenciales inválidas.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error al iniciar sesión.');
    }
  };

  const users = {
    superadmin: { email: 'miguel.gargurevich@admin.com', password: 'admin1234' },
    superadmin2: { email: 'lucia.torres@admin.com', password: 'admin1234' },
    superadmin3: { email: 'carlos.rivas@admin.com', password: 'admin1234' },
    admin1: { email: 'ana.lopez@gestionurbana.com', password: 'admin1234' },
    admin2: { email: 'laura.gutierrez@gestionurbana.com', password: 'admin1234' },
    admin3: { email: 'sonia.paredes@edificaperu.com', password: 'admin1234' },
    admin4: { email: 'alfredo.diaz@edificaperu.com', password: 'admin1234' },
    admin5: { email: 'jorge.medina@condominiosmodernos.com', password: 'admin1234' },
    admin6: { email: 'natalia.cueva@condominiosmodernos.com', password: 'admin1234' },
    admin7: { email: 'patricia.leon@residencialesdelsur.com', password: 'admin1234' },
    admin8: { email: 'andrea.salazar@residencialesdelsur.com', password: 'admin1234' },
    seguridad1: { email: 'pedro.sanchez@gestionurbana.com', password: 'seg1234' },
    seguridad2: { email: 'ricardo.pena@gestionurbana.com', password: 'seg1234' },
    seguridad3: { email: 'raul.torres@edificaperu.com', password: 'seg1234' },
    seguridad4: { email: 'monica.vera@edificaperu.com', password: 'seg1234' },
    seguridad5: { email: 'luis.vargas@condominiosmodernos.com', password: 'seg1234' },
    seguridad6: { email: 'hugo.ponce@condominiosmodernos.com', password: 'seg1234' },
    seguridad7: { email: 'carlos.paredes@residencialesdelsur.com', password: 'seg1234' },
    seguridad8: { email: 'mario.rivas@residencialesdelsur.com', password: 'seg1234' },
    mantenimiento1: { email: 'maria.fernandez@gestionurbana.com', password: 'mtto1234' },
    mantenimiento2: { email: 'silvia.torres@gestionurbana.com', password: 'mtto1234' },
    mantenimiento3: { email: 'patricia.leon@edificaperu.com', password: 'mtto1234' },
    mantenimiento4: { email: 'esteban.bravo@edificaperu.com', password: 'mtto1234' },
    mantenimiento5: { email: 'elena.salas@condominiosmodernos.com', password: 'mtto1234' },
    mantenimiento6: { email: 'rocio.diaz@condominiosmodernos.com', password: 'mtto1234' },
    mantenimiento7: { email: 'rosa.benavides@residencialesdelsur.com', password: 'mtto1234' },
    mantenimiento8: { email: 'veronica.paz@residencialesdelsur.com', password: 'mtto1234' },
    propietario1: { email: 'javier.castro@prop.com', password: 'prop1234' },
    propietario2: { email: 'sofia.ramirez@prop.com', password: 'prop1234' },
    propietario3: { email: 'gabriel.medina@prop.com', password: 'prop1234' },
    propietario4: { email: 'daniela.soto@prop.com', password: 'prop1234' },
    propietario5: { email: 'emilia.torres@prop.com', password: 'prop1234' },
    inquilino1: { email: 'valentina.ruiz@inq.com', password: 'inq1234' },
    inquilino2: { email: 'martin.herrera@inq.com', password: 'inq1234' },
    inquilino3: { email: 'camila.paredes@inq.com', password: 'inq1234' },
    inquilino4: { email: 'lucas.bravo@inq.com', password: 'inq1234' },
    inquilino5: { email: 'tomas.rios@inq.com', password: 'inq1234' },
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Columna izquierda: Formulario de login */}
      <div className="flex flex-col justify-center items-center w-full md:w-1/2 p-8">
        <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-sm mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 px-8 py-10 animate-fade-in">
          <h2 className="text-3xl font-extrabold mb-8 text-center text-primary dark:text-accent tracking-tight">Iniciar sesión</h2>
          {error && <div className="mb-4 text-red-500 text-center font-semibold animate-shake">{error}</div>}
          <div className="mb-6">
            <label className="block mb-2 font-semibold text-gray-900 dark:text-gray-100">Email</label>
            <input
              type="email"
              className="w-full px-4 py-3 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
              autoFocus
              {...register('email', {
                required: 'El email es obligatorio',
                pattern: {
                  value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
                  message: 'Formato de email inválido',
                },
              })}
            />
            {errors.email && <span className="text-xs text-red-500 mt-2 block">{errors.email.message}</span>}
          </div>
          {/* Selector rápido de usuario/rol para pruebas */}
          <div className="mb-6">
            <label className="block mb-2 font-semibold text-gray-900 dark:text-gray-100">Usuario de prueba</label>
            <select
              className="w-full px-4 py-3 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
              onChange={e => {
                const value = e.target.value as keyof typeof users;
                if (value && users[value]) {
                  reset(users[value]);
                }
              }}
              defaultValue=""
            >
              <option value="">Selecciona un usuario de prueba</option>
              <optgroup label="Superadmin">
                <option value="superadmin">Miguel Gargurevich (SuperAdmin admin1234)</option>
              </optgroup>
              <optgroup label="Admin">
                <option value="admin1">Ana López (admin1234)</option>
                <option value="admin2">Laura Gutiérrez (admin1234)</option>
              </optgroup>
              <optgroup label="Seguridad">
                <option value="seguridad1">Pedro Sánchez (seg1234)</option>
                <option value="seguridad2">Ricardo Peña (seg1234)</option>
              </optgroup>
              <optgroup label="Mantenimiento">
                <option value="mantenimiento1">María Fernández (mtto1234)</option>
                <option value="mantenimiento2">Silvia Torres (mtto1234)</option>
              </optgroup>
              <optgroup label="Propietario">
                <option value="propietario1">Javier Castro (prop1234)</option>
                <option value="propietario2">Sofía Ramírez (prop1234)</option>
              </optgroup>
              <optgroup label="Inquilino">
                <option value="inquilino4">Lucas Bravo (inq1234)</option>
                <option value="inquilino5">Tomás Ríos (inq1234)</option>
              </optgroup>
            </select>
          </div>
          <div className="mb-8">
            <label className="block mb-2 font-semibold text-gray-900 dark:text-gray-100">Contraseña</label>
            <input
              type="password"
              className="w-full px-4 py-3 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700 focus:border-primary focus:ring-2 focus:ring-primary/30 transition-all"
              {...register('password', { required: 'La contraseña es obligatoria' })}
            />
            {errors.password && <span className="text-xs text-red-500 mt-2 block">{errors.password.message}</span>}
          </div>
          <button
            type="submit"
            className="w-full bg-primary text-white py-3 rounded-lg font-bold text-lg shadow-md hover:bg-primary/90 transition-all duration-200"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
      {/* Columna derecha: Marquesina de testimonios */}
      <div className="hidden md:flex flex-col justify-center items-center w-1/2 bg-gradient-to-br from-accent/10 to-primary/10 p-8 relative overflow-hidden animate-fade-in">
        <img
          src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80"
          alt="Condominio seguro y familiar"
          className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none select-none"
        />
        {/* Difuminado arriba/abajo */}
        <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-white/80 dark:from-gray-900/80 to-transparent z-10 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-white/80 dark:from-gray-900/80 to-transparent z-10 pointer-events-none" />
        {/* Marquesina vertical animada */}
        <div className="relative w-full max-w-md h-[340px] flex items-center justify-center z-20">
          <MarquesinaTestimonios />
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
  