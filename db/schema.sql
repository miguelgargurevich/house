

-- Tabla de usuarios/personas
CREATE TABLE usuario (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  telefono VARCHAR(30),
  rol VARCHAR(30), -- admin, propietario, inquilino, etc
  password_hash VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE empresa_administradora (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  ruc VARCHAR(20),
  direccion VARCHAR(200),
  telefono VARCHAR(30),
  email VARCHAR(100),
  representante_legal VARCHAR(100),
  fecha_inicio DATE,
  fecha_fin DATE,
  estado VARCHAR(20) DEFAULT 'activa'
);

CREATE TABLE complejo_habitacional (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  tipo VARCHAR(40) NOT NULL, -- condominio, residencial, etc
  direccion VARCHAR(200),
  empresa_id INTEGER REFERENCES empresa_administradora(id),
  descripcion TEXT
);


-- Unificación de "bloque" y "casa" en estructura
CREATE TABLE estructura (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(40),
  tipo VARCHAR(20) NOT NULL, -- bloque, casa, etc
  padre_id INTEGER REFERENCES estructura(id), -- para jerarquía padre-hijo
  complejo_id INTEGER REFERENCES complejo_habitacional(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE piso (
  id SERIAL PRIMARY KEY,
  numero INTEGER,
  estructura_id INTEGER REFERENCES estructura(id)
);

CREATE TABLE unidad (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL,
  tipo VARCHAR(30) NOT NULL, -- departamento, cochera, deposito, etc
  estructura_id INTEGER REFERENCES estructura(id),
  piso_id INTEGER REFERENCES piso(id),
  complejo_id INTEGER REFERENCES complejo_habitacional(id),
  descripcion VARCHAR(120),
  propietario_id INTEGER REFERENCES usuario(id),
  empresa_id INTEGER REFERENCES empresa_administradora(id),
  estado VARCHAR(20) DEFAULT 'activa',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE concepto (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  descripcion VARCHAR(200),
  tipo_monto VARCHAR(20) DEFAULT 'fijo',
  empresa_id INTEGER REFERENCES empresa_administradora(id),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recibo (
  id SERIAL PRIMARY KEY,
  descripcion VARCHAR(200),
  fecha_emision DATE NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  mes INTEGER NOT NULL,
  anio INTEGER NOT NULL,
  estado VARCHAR(20) DEFAULT 'emitido',
  empresa_id INTEGER REFERENCES empresa_administradora(id),
  complejo_id INTEGER REFERENCES complejo_habitacional(id),
  archivo_excel_url VARCHAR(300),
  creado_por INTEGER REFERENCES usuario(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recibo_concepto (
  id SERIAL PRIMARY KEY,
  recibo_id INTEGER REFERENCES recibo(id),
  concepto_id INTEGER REFERENCES concepto(id),
  monto NUMERIC(12,2) NOT NULL,
  es_recargo BOOLEAN DEFAULT FALSE,
  orden INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recibo_concepto_unidad (
  id SERIAL PRIMARY KEY,
  recibo_concepto_id INTEGER REFERENCES recibo_concepto(id),
  unidad_id INTEGER REFERENCES unidad(id),
  monto NUMERIC(12,2) NOT NULL,
  estado_pago VARCHAR(20) DEFAULT 'pendiente',
  fecha_pago DATE,
  url_voucher VARCHAR(300),
  observaciones VARCHAR(300),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pagos parciales
CREATE TABLE pago (
  id SERIAL PRIMARY KEY,
  recibo_concepto_unidad_id INTEGER REFERENCES recibo_concepto_unidad(id),
  monto NUMERIC(12,2) NOT NULL,
  fecha_pago TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  usuario_id INTEGER REFERENCES usuario(id),
  metodo_pago VARCHAR(40),
  referencia VARCHAR(100),
  observaciones VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX idx_unidad_complejo ON unidad(complejo_id);
CREATE INDEX idx_unidad_empresa ON unidad(empresa_id);
CREATE INDEX idx_unidad_propietario ON unidad(propietario_id);
CREATE INDEX idx_recibo_empresa ON recibo(empresa_id);
CREATE INDEX idx_recibo_complejo ON recibo(complejo_id);
CREATE INDEX idx_estructura_complejo ON estructura(complejo_id);
