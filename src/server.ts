import { app } from './server/app';
import { iniciarPlanificador, planificadorActivo } from './server/services/avisos';

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
  if (planificadorActivo()) iniciarPlanificador();
});
