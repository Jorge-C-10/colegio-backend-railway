import pool from '../db.js';

export const createJornada = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            datos_salon_id,
            hora_inicio,
            tipo_bloque_id,
            tipo_duracion_bloque_id,  // ← NUEVO: ID de la duración
            dias_semana_ids = [],
            recreos = [],
            estado = 'activo'
        } = req.body;

        // 1. Validar campos obligatorios
        if (!datos_salon_id || !hora_inicio || !tipo_bloque_id || !tipo_duracion_bloque_id) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Los campos datos_salon_id, hora_inicio, tipo_bloque_id y tipo_duracion_bloque_id son obligatorios.'
            });
        }

        if (estado && !['activo', 'inactivo'].includes(estado)) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'El campo estado solo puede ser "activo" o "inactivo".'
            });
        }

        // 2. Validar que el salón exista
        const [salonExists] = await connection.query(
            'SELECT id FROM datos_salon WHERE id = ?',
            [datos_salon_id]
        );
        if (salonExists.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'El salón especificado no existe.'
            });
        }

        // 3. Verificar que el salón NO tenga ya una configuración
        const [configExists] = await connection.query(
            'SELECT id FROM configuracion_jornada WHERE datos_salon_id = ?',
            [datos_salon_id]
        );
        if (configExists.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Este salón ya tiene una configuración de jornada. Usa PUT para modificarla.'
            });
        }

        // 4. VALIDAR TIPO DE BLOQUE (cantidad)
        const [tipoBloque] = await connection.query(
            'SELECT id, cantidad_bloques FROM tipo_bloque WHERE id = ? AND estado = "activo"',
            [tipo_bloque_id]
        );

        if (tipoBloque.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'El tipo de bloque seleccionado no es válido.'
            });
        }

        // 5. VALIDAR TIPO DE DURACIÓN (minutos)
        const [tipoDuracion] = await connection.query(
            'SELECT id, minutos FROM tipo_duracion_bloque WHERE id = ? AND estado = "activo"',
            [tipo_duracion_bloque_id]
        );

        if (tipoDuracion.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'La duración de bloque seleccionada no es válida.'
            });
        }

        const bloques_por_dia = tipoBloque[0].cantidad_bloques;
        const duracion_bloque = tipoDuracion[0].minutos;

        // 6. Validar días de estudio
        if (!Array.isArray(dias_semana_ids) || dias_semana_ids.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Debe seleccionar al menos un día de estudio.'
            });
        }

        const [diasValidos] = await connection.query(
            `SELECT id FROM dias_semana WHERE id IN (${dias_semana_ids.map(() => '?').join(',')})`,
            dias_semana_ids
        );
        if (diasValidos.length !== dias_semana_ids.length) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Uno o más días de la semana no son válidos.'
            });
        }

        // 7. Validar recreos
        if (!Array.isArray(recreos)) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'El campo recreos debe ser un array.'
            });
        }

        const posicionesUsadas = [];
        for (const recreo of recreos) {
            if (!recreo.nombre || !recreo.despues_bloque || !recreo.duracion_minutos) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Cada recreo debe tener: nombre, despues_bloque y duracion_minutos.'
                });
            }
            if (recreo.despues_bloque < 1 || recreo.despues_bloque >= bloques_por_dia) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `El recreo "${recreo.nombre}" debe ir después de un bloque entre 1 y ${bloques_por_dia - 1}.`
                });
            }
            if (posicionesUsadas.includes(recreo.despues_bloque)) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `No puede haber dos recreos después del bloque #${recreo.despues_bloque}.`
                });
            }
            posicionesUsadas.push(recreo.despues_bloque);
        }

        // 8. Insertar configuración principal
        const [result] = await connection.query(
            `INSERT INTO configuracion_jornada 
             (datos_salon_id, hora_inicio, tipo_bloque_id, tipo_duracion_bloque_id, bloques_por_dia, duracion_bloque, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [datos_salon_id, hora_inicio, tipo_bloque_id, tipo_duracion_bloque_id, bloques_por_dia, duracion_bloque, estado]
        );
        const jornadaId = result.insertId;

        // 9. Insertar días de estudio
        const diasValues = dias_semana_ids.map(diaId => [jornadaId, diaId]);
        await connection.query(
            'INSERT INTO configuracion_dias (configuracion_jornada_id, dia_semana_id) VALUES ?',
            [diasValues]
        );

        // 10. Insertar recreos
        for (const recreo of recreos) {
            await connection.query(
                `INSERT INTO recreos 
                 (configuracion_jornada_id, nombre, despues_bloque, duracion_minutos)
                 VALUES (?, ?, ?, ?)`,
                [jornadaId, recreo.nombre, recreo.despues_bloque, recreo.duracion_minutos]
            );
        }

        await connection.commit();

        res.status(201).json({
            status: 'success',
            message: 'Configuración de jornada creada exitosamente.',
            data: {
                id: jornadaId,
                datos_salon_id,
                tipo_bloque_id,
                tipo_duracion_bloque_id,
                bloques_por_dia,
                duracion_bloque,
                dias_semana_ids,
                recreos,
                estado
            }
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// LISTAR TODAS LAS JORNADAS

export const getJornadas = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { datos_salon_id, estado } = req.query;

        // Consulta principal con JOINs a las tablas catálogo
        let query = `
            SELECT 
                cj.id,
                cj.datos_salon_id,
                cj.hora_inicio,
                cj.tipo_bloque_id,
                cj.tipo_duracion_bloque_id,
                cj.bloques_por_dia,
                cj.duracion_bloque,
                cj.estado,
                ds.codigo_salon,
                CONCAT(g.nombre, ' "', s.nombre, '"') AS nombre_salon,
                n.nombre AS nivel_nombre,
                g.nombre AS grado_nombre,
                s.nombre AS seccion_nombre,
                pa.anio  AS periodo_anio,
                tb.cantidad_bloques AS tb_cantidad,
                tb.descripcion AS tb_descripcion,
                tdb.minutos AS tdb_minutos,
                tdb.descripcion AS tdb_descripcion
            FROM configuracion_jornada cj
            INNER JOIN datos_salon ds       ON cj.datos_salon_id = ds.id
            INNER JOIN nivel n              ON ds.nivel_id = n.id
            INNER JOIN grado g              ON ds.grado_id = g.id
            INNER JOIN seccion s            ON ds.seccion_id = s.id
            INNER JOIN periodo_academico pa ON ds.periodo_academico_id = pa.id
            LEFT JOIN tipo_bloque tb        ON cj.tipo_bloque_id = tb.id
            LEFT JOIN tipo_duracion_bloque tdb ON cj.tipo_duracion_bloque_id = tdb.id
        `;

        const params = [];
        const conditions = [];

        if (datos_salon_id) {
            conditions.push('cj.datos_salon_id = ?');
            params.push(datos_salon_id);
        }
        if (estado) {
            conditions.push('cj.estado = ?');
            params.push(estado);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY pa.anio DESC, n.orden, g.orden, s.orden';

        const [jornadas] = await connection.query(query, params);

        // Enriquecer cada jornada con sus días y recreos
        for (const jornada of jornadas) {
            // 1. Obtener días de estudio
            const [dias] = await connection.query(
                `SELECT dw.id, dw.nombre, dw.abrev, dw.orden
                 FROM configuracion_dias cd
                 INNER JOIN dias_semana dw ON cd.dia_semana_id = dw.id
                 WHERE cd.configuracion_jornada_id = ?
                 ORDER BY dw.orden`,
                [jornada.id]
            );

            // 2. Obtener recreos
            const [recreos] = await connection.query(
                `SELECT id, nombre, despues_bloque, duracion_minutos, estado
                 FROM recreos
                 WHERE configuracion_jornada_id = ?
                 ORDER BY despues_bloque`,
                [jornada.id]
            );

            // 3. Calcular horas semanales (bloques por día * cantidad de días)
            const horas_semanales = jornada.bloques_por_dia * dias.length;

            // 4. Estructurar la respuesta de forma limpia para el frontend
            jornada.tipo_bloque = {
                id: jornada.tipo_bloque_id,
                cantidad: jornada.tb_cantidad,
                descripcion: jornada.tb_descripcion
            };
            delete jornada.tb_cantidad;
            delete jornada.tb_descripcion;

            jornada.tipo_duracion = {
                id: jornada.tipo_duracion_bloque_id,
                minutos: jornada.tdb_minutos,
                descripcion: jornada.tdb_descripcion
            };
            delete jornada.tdb_minutos;
            delete jornada.tdb_descripcion;

            jornada.dias = dias;
            jornada.recreos = recreos;
            jornada.horas_semanales = horas_semanales;
        }

        res.status(200).json({
            status: 'success',
            count: jornadas.length,
            data: jornadas
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// OBTENER JORNADA POR ID

export const getJornadaById = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        const [jornadas] = await connection.query(
            `SELECT 
                cj.id,
                cj.datos_salon_id,
                cj.hora_inicio,
                cj.bloques_por_dia,
                cj.duracion_bloque,
                cj.estado,
                ds.codigo_salon,
                CONCAT(g.nombre, ' "', s.nombre, '"') AS nombre_salon,
                n.nombre AS nivel_nombre,
                g.nombre AS grado_nombre,
                s.nombre AS seccion_nombre,
                pa.anio  AS periodo_anio
             FROM configuracion_jornada cj
             INNER JOIN datos_salon ds      ON cj.datos_salon_id = ds.id
             INNER JOIN nivel n             ON ds.nivel_id = n.id
             INNER JOIN grado g             ON ds.grado_id = g.id
             INNER JOIN seccion s           ON ds.seccion_id = s.id
             INNER JOIN periodo_academico pa ON ds.periodo_academico_id = pa.id
             WHERE cj.id = ?`,
            [id]
        );

        if (jornadas.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Configuración de jornada no encontrada.'
            });
        }

        const jornada = jornadas[0];

        const [dias] = await connection.query(
            `SELECT dw.id, dw.nombre, dw.abrev, dw.orden
             FROM configuracion_dias cd
             INNER JOIN dias_semana dw ON cd.dia_semana_id = dw.id
             WHERE cd.configuracion_jornada_id = ?
             ORDER BY dw.orden`,
            [id]
        );
        jornada.dias = dias;

        const [recreos] = await connection.query(
            `SELECT id, nombre, despues_bloque, duracion_minutos, estado
             FROM recreos
             WHERE configuracion_jornada_id = ?
             ORDER BY despues_bloque`,
            [id]
        );
        jornada.recreos = recreos;

        jornada.horas_semanales = jornada.bloques_por_dia * dias.length;

        res.status(200).json({ status: 'success', data: jornada });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// OBTENER JORNADA POR SALÓN 

export const getJornadaBySalon = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { salonId } = req.params;

        const [jornadas] = await connection.query(
            `SELECT 
                cj.id,
                cj.datos_salon_id,
                cj.hora_inicio,
                cj.bloques_por_dia,
                cj.duracion_bloque,
                cj.estado,
                ds.codigo_salon,
                CONCAT(g.nombre, ' "', s.nombre, '"') AS nombre_salon,
                n.id AS nivel_id,
                n.nombre AS nivel_nombre,
                g.id AS grado_id,
                g.nombre AS grado_nombre,
                s.id AS seccion_id,
                s.nombre AS seccion_nombre
             FROM configuracion_jornada cj
             INNER JOIN datos_salon ds ON cj.datos_salon_id = ds.id
             INNER JOIN nivel n        ON ds.nivel_id = n.id
             INNER JOIN grado g        ON ds.grado_id = g.id
             INNER JOIN seccion s      ON ds.seccion_id = s.id
             WHERE cj.datos_salon_id = ?`,
            [salonId]
        );

        if (jornadas.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Este salón aún no tiene configuración de jornada.'
            });
        }

        const jornada = jornadas[0];

        const [dias] = await connection.query(
            `SELECT dw.id, dw.nombre, dw.abrev, dw.orden
             FROM configuracion_dias cd
             INNER JOIN dias_semana dw ON cd.dia_semana_id = dw.id
             WHERE cd.configuracion_jornada_id = ?
             ORDER BY dw.orden`,
            [jornada.id]
        );
        jornada.dias = dias;

        const [recreos] = await connection.query(
            `SELECT id, nombre, despues_bloque, duracion_minutos, estado
             FROM recreos
             WHERE configuracion_jornada_id = ?
             ORDER BY despues_bloque`,
            [jornada.id]
        );
        jornada.recreos = recreos;

        jornada.horas_semanales = jornada.bloques_por_dia * dias.length;

        res.status(200).json({ status: 'success', data: jornada });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// ACTUALIZAR JORNADA

export const updateJornada = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const {
            hora_inicio,
            tipo_bloque_id,
            tipo_duracion_bloque_id,
            dias_semana_ids,
            recreos,
            estado
        } = req.body;

        // 1. Verificar que exista
        const [exists] = await connection.query(
            'SELECT * FROM configuracion_jornada WHERE id = ?',
            [id]
        );
        if (exists.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'La configuración de jornada no existe.'
            });
        }

        const jornadaActual = exists[0];

        // Valores finales (nuevos o los que ya tenía)
        let bloquesFinales = jornadaActual.bloques_por_dia;
        let duracionFinal = jornadaActual.duracion_bloque;
        let tipoBloqueFinal = jornadaActual.tipo_bloque_id;
        let tipoDuracionFinal = jornadaActual.tipo_duracion_bloque_id;

        // 2. Validar y obtener nuevos valores si se envían
        if (tipo_bloque_id !== undefined) {
            const [tipoBloque] = await connection.query(
                'SELECT id, cantidad_bloques FROM tipo_bloque WHERE id = ? AND estado = "activo"',
                [tipo_bloque_id]
            );
            if (tipoBloque.length === 0) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'El tipo de bloque seleccionado no es válido.'
                });
            }
            tipoBloqueFinal = tipo_bloque_id;
            bloquesFinales = tipoBloque[0].cantidad_bloques;
        }

        if (tipo_duracion_bloque_id !== undefined) {
            const [tipoDuracion] = await connection.query(
                'SELECT id, minutos FROM tipo_duracion_bloque WHERE id = ? AND estado = "activo"',
                [tipo_duracion_bloque_id]
            );
            if (tipoDuracion.length === 0) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'La duración de bloque seleccionada no es válida.'
                });
            }
            tipoDuracionFinal = tipo_duracion_bloque_id;
            duracionFinal = tipoDuracion[0].minutos;
        }

        // 3. Validaciones generales
        if (estado && !['activo', 'inactivo'].includes(estado)) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'El campo estado solo puede ser "activo" o "inactivo".'
            });
        }

        // 4. Actualizar configuración principal
        await connection.query(
            `UPDATE configuracion_jornada SET 
                hora_inicio             = ?,
                tipo_bloque_id          = ?,
                tipo_duracion_bloque_id = ?,
                bloques_por_dia         = ?,
                duracion_bloque         = ?,
                estado                  = ?
             WHERE id = ?`,
            [
                hora_inicio !== undefined ? hora_inicio : jornadaActual.hora_inicio,
                tipoBloqueFinal,
                tipoDuracionFinal,
                bloquesFinales,
                duracionFinal,
                estado !== undefined ? estado : jornadaActual.estado,
                id
            ]
        );

        // 5. Reemplazar días (si se envían)
        if (dias_semana_ids !== undefined) {
            if (!Array.isArray(dias_semana_ids) || dias_semana_ids.length === 0) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Debe seleccionar al menos un día de estudio.'
                });
            }

            const [diasValidos] = await connection.query(
                `SELECT id FROM dias_semana WHERE id IN (${dias_semana_ids.map(() => '?').join(',')})`,
                dias_semana_ids
            );
            if (diasValidos.length !== dias_semana_ids.length) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Uno o más días de la semana no son válidos.'
                });
            }

            await connection.query(
                'DELETE FROM configuracion_dias WHERE configuracion_jornada_id = ?',
                [id]
            );
            const diasValues = dias_semana_ids.map(diaId => [id, diaId]);
            await connection.query(
                'INSERT INTO configuracion_dias (configuracion_jornada_id, dia_semana_id) VALUES ?',
                [diasValues]
            );
        }

        // 6. Reemplazar recreos (si se envían)
        if (recreos !== undefined) {
            if (!Array.isArray(recreos)) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'El campo recreos debe ser un array.'
                });
            }

            const posicionesUsadas = [];
            for (const recreo of recreos) {
                if (!recreo.nombre || !recreo.despues_bloque || !recreo.duracion_minutos) {
                    await connection.rollback();
                    return res.status(400).json({
                        status: 'error',
                        message: 'Cada recreo debe tener: nombre, despues_bloque y duracion_minutos.'
                    });
                }
                // Usamos bloquesFinales (que ya puede ser el nuevo valor) para validar
                if (recreo.despues_bloque < 1 || recreo.despues_bloque >= bloquesFinales) {
                    await connection.rollback();
                    return res.status(400).json({
                        status: 'error',
                        message: `El recreo "${recreo.nombre}" debe ir después de un bloque entre 1 y ${bloquesFinales - 1}.`
                    });
                }
                if (posicionesUsadas.includes(recreo.despues_bloque)) {
                    await connection.rollback();
                    return res.status(400).json({
                        status: 'error',
                        message: `No puede haber dos recreos después del bloque #${recreo.despues_bloque}.`
                    });
                }
                posicionesUsadas.push(recreo.despues_bloque);
            }

            await connection.query(
                'DELETE FROM recreos WHERE configuracion_jornada_id = ?',
                [id]
            );

            for (const recreo of recreos) {
                await connection.query(
                    `INSERT INTO recreos 
                     (configuracion_jornada_id, nombre, despues_bloque, duracion_minutos)
                     VALUES (?, ?, ?, ?)`,
                    [id, recreo.nombre, recreo.despues_bloque, recreo.duracion_minutos]
                );
            }
        }

        await connection.commit();

        res.status(200).json({
            status: 'success',
            message: 'Configuración de jornada actualizada exitosamente.',
            data: {
                id: parseInt(id),
                tipo_bloque_id: tipoBloqueFinal,
                tipo_duracion_bloque_id: tipoDuracionFinal,
                bloques_por_dia: bloquesFinales,
                duracion_bloque: duracionFinal
            }
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// ELIMINAR JORNADA

export const deleteJornada = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        // 1. Verificar que exista
        const [exists] = await connection.query(
            'SELECT id FROM configuracion_jornada WHERE id = ?',
            [id]
        );
        if (exists.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'La configuración de jornada no existe.'
            });
        }

        // 2. Verificar si está en uso
        try {
            const [enUsoCursos] = await connection.query(
                'SELECT id FROM curso_docente_salon WHERE configuracion_jornada_id = ? LIMIT 1',
                [id]
            );
            const [enUsoReglas] = await connection.query(
                'SELECT id FROM reglas_horario WHERE configuracion_jornada_id = ? LIMIT 1',
                [id]
            );

            if (enUsoCursos.length > 0 || enUsoReglas.length > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'No se puede eliminar: la jornada tiene cursos o reglas asociadas. Elimínelas primero.'
                });
            }
        } catch (tableError) {
            console.log('⚠️ Tablas de uso aún no creadas, se omite validación.');
        }

        // 3. Eliminar (CASCADE borra días y recreos automáticamente)
        await connection.query('DELETE FROM configuracion_jornada WHERE id = ?', [id]);

        res.status(200).json({
            status: 'success',
            message: 'Configuración de jornada eliminada exitosamente.'
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// LISTAR TIPOS DE BLOQUE 

export const getTiposBloque = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const [tipos] = await connection.query(
            `SELECT id, cantidad_bloques, duracion_recomendada, descripcion
             FROM tipo_bloque
             WHERE estado = 'activo'
             ORDER BY cantidad_bloques`
        );

        res.status(200).json({
            status: 'success',
            data: tipos
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// LISTAR DÍAS DE LA SEMANA

export const getDiasSemana = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const [dias] = await connection.query(
            `SELECT id, nombre, abrev, orden
             FROM dias_semana
             ORDER BY orden`
        );

        res.status(200).json({
            status: 'success',
            count: dias.length,
            data: dias
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// LISTAR TIPOS DE DURACIÓN DE BLOQUE

export const getTiposDuracionBloque = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const [tipos] = await connection.query(
            `SELECT id, minutos, descripcion, es_recomendado
             FROM tipo_duracion_bloque
             WHERE estado = 'activo'
             ORDER BY minutos`
        );

        res.status(200).json({
            status: 'success',
            data: tipos
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};