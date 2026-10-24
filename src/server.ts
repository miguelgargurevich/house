import { app } from './server/app';
import { iniciarLimpieza } from './server/services/sesiones';
import { iniciarPlanificador, planificadorActivo } from './server/services/avisos';

const PORT = Number(process.env.PORT) || 4000;
iniciarLimpieza();
app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
  if (planificadorActivo()) iniciarPlanificador();
});
