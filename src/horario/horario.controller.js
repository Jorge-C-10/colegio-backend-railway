import pool from '../db.js';

// =============================================
// GENERAR Y GUARDAR HORARIO AUTOMÁTICO
// POST /api/horario/generar
// =============================================
export const generarHorario = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { configuracion_jornada_id } = req.body;

        // 1. Validar
        if (!configuracion_jornada_id) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'El campo configuracion_jornada_id es obligatorio.'
            });
        }

        // 2. Obtener configuración de jornada
        const [jornada] = await connection.query(
            `SELECT cj.*, 
                    tdb.minutos AS duracion_bloque_minutos,
                    ds.codigo_salon
             FROM configuracion_jornada cj
             INNER JOIN tipo_duracion_bloque tdb ON cj.tipo_duracion_bloque_id = tdb.id
             LEFT JOIN datos_salon ds ON cj.datos_salon_id = ds.id
             WHERE cj.id = ? AND cj.estado = 'activo'`,
            [configuracion_jornada_id]
        );

        if (jornada.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Configuración de jornada no encontrada.'
            });
        }

        const config = jornada[0];
        const bloquesPorDia = config.bloques_por_dia;
        const duracionBloque = config.duracion_bloque_minutos;
        const horaInicio = config.hora_inicio;

        // 3. Obtener días de estudio
        const [dias] = await connection.query(
            `SELECT ds.id, ds.nombre, ds.abrev, ds.orden
             FROM configuracion_dias cd
             INNER JOIN dias_semana ds ON cd.dia_semana_id = ds.id
             WHERE cd.configuracion_jornada_id = ?
             ORDER BY ds.orden`,
            [configuracion_jornada_id]
        );

        // 4. Obtener recreos
        const [recreos] = await connection.query(
            `SELECT nombre, despues_bloque, duracion_minutos
             FROM recreos
             WHERE configuracion_jornada_id = ? AND estado = 'activo'
             ORDER BY despues_bloque`,
            [configuracion_jornada_id]
        );

        // 5. Obtener cursos asignados
        const [cursos] = await connection.query(
            `SELECT cds.id, cds.curso_id, cds.docente_id, cds.horas_semanales, c.nombre AS curso_nombre
             FROM curso_docente_salon cds
             INNER JOIN curso c ON cds.curso_id = c.id
             WHERE cds.configuracion_jornada_id = ? AND cds.estado = 'activo'`,
            [configuracion_jornada_id]
        );

        if (cursos.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'No hay cursos asignados a este salón.'
            });
        }

        // 6. Obtener reglas activas
        // 6. Obtener reglas activas (usando reglas_horario_detalle)
        const [reglasDetalle] = await connection.query(
            `SELECT tipo_regla_id, activa
     FROM reglas_horario_detalle
     WHERE configuracion_jornada_id = ?`,
            [configuracion_jornada_id]
        );

        // Convertir a objeto para fácil acceso
        const reglasActivas = {
            anti_cruce_docente: 0,
            cursos_pesados_antes_recreo: 0,
            bloques_continuos_laboratorio: 0,
            cero_horas_muertas_docentes: 0
        };

        reglasDetalle.forEach(r => {
            if (r.tipo_regla_id === 1) reglasActivas.anti_cruce_docente = r.activa;
            if (r.tipo_regla_id === 2) reglasActivas.cursos_pesados_antes_recreo = r.activa;
            if (r.tipo_regla_id === 3) reglasActivas.bloques_continuos_laboratorio = r.activa;
            if (r.tipo_regla_id === 4) reglasActivas.cero_horas_muertas_docentes = r.activa;
        });
        // 7. ALGORITMO: Distribuir cursos en bloques
        const horarioGenerado = [];
        const cruces = [];
        const ocupacionDocente = {}; // { docente_id: { dia: [bloques ocupados] } }

        // Inicializar ocupación
        cursos.forEach(c => {
            ocupacionDocente[c.docente_id] = {};
            dias.forEach(d => {
                ocupacionDocente[c.docente_id][d.id] = [];
            });
        });

        // Calcular bloques necesarios por curso
        const bloquesNecesarios = {};
        cursos.forEach(curso => {
            const bloques = Math.ceil(curso.horas_semanales * 60 / duracionBloque);
            bloquesNecesarios[curso.id] = {
                ...curso,
                bloques_necesarios: bloques,
                bloques_asignados: 0
            };
        });

        // Distribuir cursos en días y bloques
        for (const curso of Object.values(bloquesNecesarios)) {
            let bloquesRestantes = curso.bloques_necesarios;
            let diaIndex = 0;

            while (bloquesRestantes > 0 && diaIndex < dias.length) {
                const dia = dias[diaIndex];
                const bloquesOcupados = ocupacionDocente[curso.docente_id][dia.id];

                // Buscar bloques libres
                for (let bloque = 1; bloque <= bloquesPorDia && bloquesRestantes > 0; bloque++) {
                    // Verificar si el bloque está libre para este docente
                    if (!bloquesOcupados.includes(bloque)) {
                        // Verificar anti-cruce (si está activa)
                        if (reglasActivas.anti_cruce_docente) {
                            const [cruce] = await connection.query(
                                `SELECT id FROM horario_generado 
                                 WHERE docente_id = ? AND dia_semana_id = ? AND bloque_inicio = ? 
                                 AND estado = 'activo'`,
                                [curso.docente_id, dia.id, bloque]
                            );
                            if (cruce.length > 0) {
                                cruces.push({
                                    tipo: 'cruce_docente',
                                    mensaje: `Profesor ${curso.docente_id} ya tiene clase en bloque ${bloque} del ${dia.nombre}`,
                                    curso_id: curso.curso_id,
                                    dia_id: dia.id,
                                    bloque: bloque
                                });
                                continue;
                            }
                        }

                        // Calcular hora inicio y fin
                        const minutosDesdeInicio = (bloque - 1) * duracionBloque;
                        const horaInicioBloque = new Date(`2000-01-01 ${horaInicio}`);
                        horaInicioBloque.setMinutes(horaInicioBloque.getMinutes() + minutosDesdeInicio);
                        const horaFinBloque = new Date(horaInicioBloque.getTime() + duracionBloque * 60000);

                        // Verificar recreos
                        const recreoAntes = recreos.find(r => r.despues_bloque === bloque - 1);
                        if (recreoAntes) {
                            horaInicioBloque.setMinutes(horaInicioBloque.getMinutes() + recreoAntes.duracion_minutos);
                            horaFinBloque.setMinutes(horaFinBloque.getMinutes() + recreoAntes.duracion_minutos);
                        }

                        // Insertar en horario
                        horarioGenerado.push({
                            configuracion_jornada_id,
                            curso_id: curso.curso_id,
                            docente_id: curso.docente_id,
                            dia_semana_id: dia.id,
                            bloque_inicio: bloque,
                            bloque_fin: bloque,
                            hora_inicio: horaInicioBloque.toTimeString().split(' ')[0],
                            hora_fin: horaFinBloque.toTimeString().split(' ')[0],
                            aula: null
                        });

                        // Marcar bloque como ocupado
                        bloquesOcupados.push(bloque);
                        bloquesRestantes--;
                    }
                }
                diaIndex++;
            }
        }

        // 8. Guardar horario generado
        if (horarioGenerado.length > 0) {
            const valores = horarioGenerado.map(h => [
                h.configuracion_jornada_id,
                h.curso_id,
                h.docente_id,
                h.dia_semana_id,
                h.bloque_inicio,
                h.bloque_fin,
                h.hora_inicio,
                h.hora_fin,
                h.aula
            ]);

            await connection.query(
                `INSERT INTO horario_generado 
                 (configuracion_jornada_id, curso_id, docente_id, dia_semana_id, 
                  bloque_inicio, bloque_fin, hora_inicio, hora_fin, aula)
                 VALUES ?`,
                [valores]
            );
        }

        await connection.commit();

        // 9. Calcular estadísticas
        const totalHoras = (horarioGenerado.length * duracionBloque) / 60;
        const horasMaximas = dias.length * bloquesPorDia * duracionBloque / 60;

        res.status(201).json({
            status: 'success',
            message: `Horario generado exitosamente. ${cruces.length} cruce(s) detectado(s).`,
            data: {
                configuracion_jornada_id,
                total_bloques_asignados: horarioGenerado.length,
                total_horas: totalHoras,
                horas_maximas: horasMaximas,
                cruces: cruces.length,
                detalle_cruces: cruces,
                horario: horarioGenerado
            }
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// =============================================
// OBTENER HORARIO GENERADO
// GET /api/horario/:configuracion_jornada_id
// =============================================
export const getHorario = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { configuracion_jornada_id } = req.params;

        const [horario] = await connection.query(
            `SELECT 
                hg.id,
                hg.curso_id,
                hg.docente_id,
                hg.bloque_inicio,
                hg.bloque_fin,
                hg.hora_inicio,
                hg.hora_fin,
                hg.aula,
                c.nombre AS curso_nombre,
                c.color AS curso_color,
                d.nombres_completos AS docente_nombre,
                ds.abrev AS dia_abrev,
                ds.nombre AS dia_nombre,
                ds.orden AS dia_orden
             FROM horario_generado hg
             INNER JOIN curso c ON hg.curso_id = c.id
             INNER JOIN docente d ON hg.docente_id = d.id
             INNER JOIN dias_semana ds ON hg.dia_semana_id = ds.id
             WHERE hg.configuracion_jornada_id = ? AND hg.estado = 'activo'
             ORDER BY ds.orden, hg.bloque_inicio`,
            [configuracion_jornada_id]
        );

        res.status(200).json({
            status: 'success',
            count: horario.length,
            data: horario
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// =============================================
// ELIMINAR HORARIO GENERADO
// DELETE /api/horario/:configuracion_jornada_id
// =============================================
export const deleteHorario = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { configuracion_jornada_id } = req.params;

        await connection.query(
            "UPDATE horario_generado SET estado = 'inactivo' WHERE configuracion_jornada_id = ?",
            [configuracion_jornada_id]
        );

        res.status(200).json({
            status: 'success',
            message: 'Horario eliminado exitosamente.'
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};