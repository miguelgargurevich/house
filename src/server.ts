import { app } from './server/app';

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
