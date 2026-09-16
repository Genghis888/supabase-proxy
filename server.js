const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase config (variáveis de ambiente no Render)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Verificar variáveis de ambiente
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERRO: Defina SUPABASE_URL e SUPABASE_ANON_KEY no Render');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// CORS para o Neocities
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Endpoint: buscar visitantes
app.get('/api/visitors', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 2;
    const local = req.query.local || '';

    const agora = new Date();
    const limite = new Date(agora.getTime() - hours * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('visits')
      .select('page_title, last_seen, host')
      .gte('last_seen', limite.toISOString())
      .order('last_seen', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Filtro: page_title com 2 hífens (formato: Nome - ID - Local)
    const regex = /^.{2,} - \d+ - .{2,}$/;
    const filtrados = (data || []).filter(v => v.page_title && regex.test(v.page_title));

    // Filtro por local
    const filtradosLocal = local
      ? filtrados.filter(v => {
          const partes = v.page_title.split(' - ');
          const localRegistro = (partes[2] || '').trim();
          const hostRegistro = (v.host || '').trim();
          return localRegistro.toLowerCase() === local.toLowerCase() ||
                 hostRegistro.toLowerCase() === local.toLowerCase();
        })
      : filtrados;

    // Parse
    const parseados = filtradosLocal.map(v => {
      const partes = v.page_title.split(' - ');
      return {
        nome: partes[0].trim(),
        id: partes[1].trim(),
        local: partes[2].trim(),
        last_seen: v.last_seen
      };
    });

    // Deduplicar por ID (manter o mais recente)
    const mapa = new Map();
    parseados.forEach(v => {
      const existente = mapa.get(v.id);
      if (!existente || new Date(v.last_seen) > new Date(existente.last_seen)) {
        mapa.set(v.id, v);
      }
    });

    // Ordenar por ID crescente
    const visitantes = [...mapa.values()].sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true })
    );

    res.json({
      total_bruto: data ? data.length : 0,
      total_validos: filtrados.length,
      visitantes: visitantes.map(v => ({
        nome: v.nome,
        id: v.id,
        local: v.local
      }))
    });

  } catch (e) {
    console.error('Erro:', e);
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', supabase: !!SUPABASE_URL, version: '1.1' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// ==================== AUTO-PING (manter Render ativo) ====================
// Render free tier fica inativo após 15 min sem tráfego
// Este ping a cada 10 minutos mantém o serviço vivo
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

setInterval(async () => {
  try {
    const res = await fetch(SELF_URL + '/api/health');
    const data = await res.json();
    console.log('[PING] Servidor ativo:', data.status);
  } catch (e) {
    console.log('[PING] Erro:', e.message);
  }
}, 10 * 60 * 1000); // A cada 10 minutos

console.log('[PING] Auto-ping configurado a cada 10 minutos');
