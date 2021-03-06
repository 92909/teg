const express = require('express')
const app = express()
const http = require('http').Server(app)
const io = require('socket.io')(http)
const bodyParser = require('body-parser')
const enfrentamiento = require("./enfrentamiento")
const PaisDto = require("./paisDto").PaisDto
const JugadorDto = require("./jugadorDto").JugadorDto
const Pais = require("./modelos/paises").Pais
const Limite = require('./modelos/limites').Limite
const CartaGlobal = require('./modelos/cartaGlobales')
const ContinenteDto = require('./continenteDto').ContinenteDto
const Continente = require('./modelos/continentes').Continente
const Objetivo = require('./modelos/objetivos').Objetivo
require('./modelos/escudos').Escudo

const colores = ["ROJO", "VERDE", "AZUL", "NARANJA", "CELESTE"]

const juegos = {}

let cargaPaises
const paisesDto = []

const mazoPaisesDto = []
const mazoCartaGlobales = []
const mazoContinentes = []
let mazoObjetivos = []

const FASE8 = 8
const FASE4 = 4
const MISILES = 6

let fase8 = true
let fase4 = false
let faseAtaque = false
let faseReagrupe = false
let faseRecarga = false
let captura = false
let fichas = FASE8

Pais.find().populate('continente').populate('escudo').exec((err, paises) => {
	if (err) return console.error(err)

	Limite.find((err, limites) => {
		if (err) return console.error(err)
		for (let limite of limites) {
			paises[limite.pais1 - 1].limites.push(paises[limite.pais2 - 1])
			paises[limite.pais2 - 1].limites.push(paises[limite.pais1 - 1])
		}
		cargaPaises = paises
		
		Continente.find().populate('escudo').exec((err, continentes) => {
			if (err) return console.error(err)
			for (let continente of continentes) {
				mazoContinentes.push(new ContinenteDto(continente))
			}
			
			for (let pais of paises) {
				const paisDto = new PaisDto(pais)
				paisDto.continente = mazoContinentes[pais.continente.id - 1]
				paisesDto.push(paisDto)
				for (let limite of pais.limites) {
					paisDto.limites.push(limite.id)
				}
			}
			mazoPaisesDto.push(...paisesDto)
			desordenar(mazoPaisesDto)
		})
	})
})

CartaGlobal.find((err, cartaGlobales) => {
	if (err) return console.error(err)
	for (let cartaGlobal of cartaGlobales) {
		for (let i = 0; i < cartaGlobal.cantidad; i++) {
			mazoCartaGlobales.push(cartaGlobal)
		}
		if (!cartaGlobal.ataque) cartaGlobal.ataque = 0
		if (!cartaGlobal.defensa) cartaGlobal.defensa = 0
	}
	desordenar(mazoCartaGlobales)
})

Objetivo.find((err, objetivos) => {
	if (err) return console.error(err)
	mazoObjetivos = desordenar(objetivos)
})

app.use(express.static(`${__dirname}/public`))

//extended: false significa que parsea solo string (no archivos de imagenes por ejemplo)
app.use(bodyParser.urlencoded({ extended: false }))

app.set('view engine', 'pug')
app.set('views', './views')

app.get('/', (req, res) => {
	res.render('index')
})

app.post('/registrar', (req, res) => {
	res.render('index', {
		mensaje: `usuario ${req.body.nombre} registrado`
	})
})

app.post('/entrar', (req, res) => {
	res.render('salas', {
		nombre: req.body.nombre
	})
})

app.post('/salaEspera', (req, res) => {
	res.render('salaEspera', {
		nombre: req.body.nombre,
		sala: req.body.sala
	})
})

const clienteSala = {}
const salas = {}
const salaEspera = io.of('salas')
salaEspera.on('connection', cliente => {

    cliente.on('nombre', nombre => {
        clienteSala[nombre] = cliente
		cliente.nombre = nombre
        console.log(`${nombre} conectado`)
        cliente.emit("salas", salas)
	})

	cliente.on('disconnect', () => {
        console.log(`${cliente.nombre} desconectado`)
        salir(cliente)
    })
    
    cliente.on("crear", () => {
        if (cliente.sala || salas[cliente.nombre]) return
        salas[cliente.nombre] = {
            nombre: cliente.nombre,
            integrantes: [cliente.nombre]
        }
        cliente.sala = salas[cliente.nombre]
        cliente.join(cliente.nombre)
        salaEspera.emit("salas", salas)
    })

    cliente.on("unirse", nombre => {
        if (cliente.sala) return
        salas[nombre].integrantes.push(cliente.nombre)
        cliente.sala = salas[nombre]
        cliente.join(nombre)
        salaEspera.emit("salas", salas)
    })

    cliente.on("salir", () => {
        salir(cliente)
        salaEspera.emit("salas", salas)
    })

    cliente.on("chatear", msg => {
        if (cliente.sala) {
            salaEspera.to(cliente.sala.nombre).emit("chatear", msg)
        }
	})
	
	cliente.on("iniciar", sala => {
		for (let nombre of salas[sala].integrantes) {
			clienteSala[nombre].emit("iniciar", {nombre, sala})
		}
    })

})

function salir(cliente) {
    if (salas[cliente.nombre]) {
        delete salas[cliente.sala.nombre]
        for (let nombre of cliente.sala.integrantes) {
            clienteSala[nombre].sala = null
        }
        cliente.leave(cliente.nombre)
    } else if (cliente.sala) {
        cliente.sala.integrantes.splice(cliente.sala.integrantes.indexOf(cliente.nombre), 1)
        cliente.leave(cliente.sala.nombre)
        cliente.sala = null
    }
}

let turno = 0
let cartaGlobal
const traslados = []
const jugadores = []
const jugadorDtos = []
const clientes = {}
const teg = io.of('teg')
teg.on('connection', cliente => {
	cliente.on('nombre', jugador => {
		clientes[jugador.nombre] = cliente
		cliente.sala = jugador.sala
		cliente.join(jugador.sala)
		console.log(`${jugador.nombre} jugando`)
		teg.to(jugador.sala).emit("listaJugadores", Object.keys(clientes))
	})

	cliente.on('disconnect', () => {
		for (let nombre in clientes) {
			if (clientes[nombre] == cliente) {
				jugadorDtos.splice(jugadores.indexOf(cliente), 1)
				jugadores.splice(jugadores.indexOf(cliente), 1)
				console.log(`${nombre} desjugando`)
				delete clientes[nombre]
				teg.to(cliente.sala).emit("listaJugadores", Object.keys(clientes))
				break
			}
		}
	})

	cliente.on('inicio', () => {
		desordenar(colores)
		for (let nombre in clientes) {
			jugadores.push(clientes[nombre])
			jugadorDtos.push(new JugadorDto(colores[jugadorDtos.length], nombre))
		}
		teg.to(cliente.sala).emit("jugadores", jugadorDtos)
		for (let i = 0; i < jugadorDtos.length; i++) {
			jugadorDtos[i].objetivo = mazoObjetivos.pop()
			jugadores[i].emit("objetivo", jugadorDtos[i])
		}
		for (let i = 0; i < mazoPaisesDto.length; i++) {
			mazoPaisesDto[i].jugador = jugadorDtos[i % jugadorDtos.length].color
		}
		for (let paisDto of mazoPaisesDto) {
			traslados[paisDto.id - 1] = { ejercitos: 0, misiles: 0 }
		}
		teg.to(cliente.sala).emit("iniciaJuego", paisesDto)
		teg.to(cliente.sala).emit("turno", jugadorDtos[turno % jugadorDtos.length].nombre)
		teg.to(cliente.sala).emit("fichas", fichas)
		desordenar(mazoPaisesDto)
	})

	cliente.on('ataque', ataque => {
		const paisDtoA = paisesDto[ataque.ataque - 1]
		const paisDtoD = paisesDto[ataque.defensa - 1]
		try {
			validarTurno(cliente, paisDtoA)
			const distancia = validarAtaque(paisDtoA, paisDtoD)
			if (distancia == 0) {
				validarFaseRecargaMisiles()
				if (paisDtoA.ejercitos <= MISILES) {
					throw ("no hay suficiente para comprar misiles")
				}
				paisDtoA.ejercitos -= MISILES
				paisDtoD.misiles++
			} else if (distancia != 1) {
				throw ("no son limitrofes")
			} else if (paisDtoA.jugador == paisDtoD.jugador) {
				validarFaseReagrupe()
				if (traslados[paisDtoA.id - 1].ejercitos <= 0) {
					throw ("no se puede trasladar mas ejercitos desde este pais")
				}
				traslados[paisDtoA.id - 1].ejercitos--
				paisDtoA.ejercitos--
				paisDtoD.ejercitos++
			} else {
				validarFaseAtaque()
				if (cartaGlobal.fronteraAbierta && paisDtoA.continente.id == paisDtoD.continente.id) {
					throw ("en fronteras abiertas hay que atacar fuera del continente")
				}
				if (cartaGlobal.fronteraCerrada && paisDtoA.continente.id != paisDtoD.continente.id) {
					throw ("en fronteras cerradas hay que atacar dentro del continente")
				}
				const ejercitosA = paisDtoA.ejercitos
				const ejercitosD = paisDtoD.ejercitos
				const dadosA = enfrentamiento.tirarDadosA(ejercitosA, ejercitosD, cartaGlobal.ataque)
				teg.to(cliente.sala).emit("dadosA", dadosA)
				const dadosD = enfrentamiento.tirarDadosD(ejercitosD, cartaGlobal.defensa)
				teg.to(cliente.sala).emit("dadosD", dadosD)
				const enfrentamientos = enfrentamiento.enfrentamientos(ejercitosA, ejercitosD)
				const resultado = enfrentamiento.atacar(dadosA, dadosD, enfrentamientos)
				paisDtoD.ejercitos -= resultado
				paisDtoA.ejercitos -= enfrentamientos - resultado
				const jugadorActual = jugadorDtos[turno % jugadorDtos.length]
				if (paisDtoD.ejercitos < 1) {
					if (jugadorActual.gana(paisDtoD, paisesDto, mazoContinentes)) {
						throw ("guau")
					}
					jugadorActual.paisesCapturadosRonda++
					paisDtoA.ejercitos--
					paisDtoD.ejercitos++
					let jugadorAtacado
					for (let jugadorDto of jugadorDtos) {
						if (jugadorDto.color == paisDtoD.jugador) {
							jugadorAtacado = jugadorDto
						}
					}
					if (jugadorAtacado.conquistaContinente(paisesDto, paisDtoD.continente)) {
						jugadorAtacado.cartasContinente.splice(jugadorAtacado.cartasContinente.indexOf(paisDtoD.continente), 1)
						clientes[paisDtoD.jugador].emit("objetivo", jugadorAtacado)
					}
					paisDtoD.jugador = paisDtoA.jugador
					if (jugadorActual.conquistaContinente(paisesDto, paisDtoD.continente)) {
						jugadorActual.cartasContinente.push(mazoContinentes[paisDtoD.continente.id - 1])
						cliente.emit("objetivo", jugadorActual)
					}
					faseAtaque = false
					captura = true
					for (let paisDto of paisesDto) {
						traslados[paisDto.id - 1].ejercitos = 0
						traslados[paisDto.id - 1].misiles = 0 
					}
					traslados[paisDtoA.id - 1].ejercitos = 2
				}
			}
			teg.to(cliente.sala).emit("resultado", { ataque: paisDtoA, defensa: paisDtoD })
		} catch (e) {
			console.log(e)
			cliente.emit('jugadaInvalida', e)
		}
	})

	cliente.on('misil', misil => {
		const paisDtoA = paisesDto[misil.ataque - 1]
		const paisDtoD = paisesDto[misil.defensa - 1]
		try {
			validarTurno(cliente, paisDtoA)
			const distancia = validarMisil(paisDtoA, paisDtoD)
			if (distancia == 0) {
				validarFaseRecargaMisiles()
				if (paisDtoA.misiles <= 0) {
					throw ("no hay suficiente para vender misiles")
				}
				paisDtoD.ejercitos += MISILES
				paisDtoA.misiles--
			} else if (distancia != 1 && paisDtoA.jugador == paisDtoD.jugador) {
				throw ("no son limitrofes")
			} else if (paisDtoA.jugador == paisDtoD.jugador) {
				validarFaseReagrupe()
				if (traslados[paisDtoA.id - 1].misiles <= 0) {
					throw ("no se puede trasladar mas misiles desde este pais")
				}
				traslados[paisDtoA.id - 1].misiles--
				paisDtoD.misiles++
				paisDtoA.misiles--
			} else {
				validarFaseAtaque()
				const dano = 4 - distancia
				if (paisDtoD.ejercitos <= dano) {
					throw ("no se puede matar un pais")
				}
				if (paisDtoA.misiles <= paisDtoD.misiles) {
					throw ("no se puede tirar misil con menos paises que el otro ")
				}
				teg.to(cliente.sala).emit("dadosA", "lanza un misil")
				paisDtoA.misiles--
				paisDtoD.ejercitos -= dano
			}
			teg.to(cliente.sala).emit("resultado", { ataque: paisDtoA, defensa: paisDtoD })
		} catch (e) {
			console.log(e)
			cliente.emit('jugadaInvalida', e)
		}

	})
	cliente.on('pasarTurno', () => {
		try {
			if (jugadores[turno % jugadores.length] != cliente) {
				throw ('no es tu turno')
			}
			if (fichas > 0) {
				throw ("quedan fichas")
			}
			if (captura) {
				faseAtaque = true
				captura = false
				return
			}
			if (faseAtaque) {
				faseAtaque = false
				faseReagrupe = true
				for (let paisDto of paisesDto) {
					traslados[paisDto.id - 1].ejercitos = paisDto.ejercitos
					traslados[paisDto.id - 1].misiles = paisDto.misiles 
				}
				return
			}
			let jugadorActual = jugadorDtos[turno % jugadorDtos.length]
			if (faseReagrupe) {
				if (jugadorActual.puedeSacarCarta()) {
					const carta = mazoPaisesDto.splice(0, 1)[0]
					jugadorActual.cartasPais.push(carta)
					cliente.emit("objetivo", jugadorActual)
					if (carta.jugador == jugadorActual.color) {
						carta.ejercitos += 3
						teg.to(cliente.sala).emit("ponerPais", carta)
					}
				}
				jugadorActual.paisesCapturadosRonda = 0
			}
			turno++
			jugadorActual = jugadorDtos[turno % jugadorDtos.length]
			if (turno % jugadores.length == 0) {
				if (fase8) {
					fase8 = false
					fase4 = true
					fichas = FASE4
					teg.to(cliente.sala).emit("fichas", fichas)
				} else if (fase4) {
					fase4 = false
					faseAtaque = true
					cartaGlobal = mazoCartaGlobales.pop()
					teg.to(cliente.sala).emit("cartaGlobal", cartaGlobal)
				} else if (faseReagrupe) {
					faseReagrupe = false
					faseRecarga = true
					fichas = parseInt(jugadorActual.paisesJugador(paisesDto).length / 2)
					for (let continente of jugadorActual.cartasContinente) {
						fichas += continente.fichas
					}
					teg.to(cliente.sala).emit("fichas", fichas)
				} else if (faseRecarga) {
					faseRecarga = false
					faseAtaque = true
					cartaGlobal = mazoCartaGlobales.pop()
					teg.to(cliente.sala).emit("cartaGlobal", cartaGlobal)
				}
			} else {
				if (fase8) {
					fichas = FASE8
					teg.to(cliente.sala).emit("fichas", fichas)
				} else if (fase4) {
					fichas = FASE4
					teg.to(cliente.sala).emit("fichas", fichas)
				} else if (faseReagrupe) {
					faseReagrupe = false
					faseAtaque = true
				} else if (faseRecarga) {
					fichas = parseInt(jugadorActual.paisesJugador(paisesDto).length / 2)
					for (let continente of jugadorActual.cartasContinente) {
						fichas += continente.fichas
					}
					teg.to(cliente.sala).emit("fichas", fichas)
				}
			}
			teg.to(cliente.sala).emit("turno", jugadorActual.nombre)
		} catch (e) {
			console.log(e)
			cliente.emit('jugadaInvalida', e)
		}
	})
	cliente.on('ponerFicha', idPais => {
		const paisDto = paisesDto[idPais - 1]
		try {
			validarTurno(cliente, paisDto)
			validarFaseRecarga()
			if (fichas <= 0) {
				throw ("no quedan fichas para poner")
			}
			validarBloqueo(paisDto)
			paisDto.ejercitos++
			fichas--
			teg.to(cliente.sala).emit("fichas", fichas)
			teg.to(cliente.sala).emit("ponerPais", paisDto)
		} catch (e) {
			console.log(e)
			cliente.emit('jugadaInvalida', e)
		}
	})
	cliente.on('ponerMisil', idPais => {
		const paisDto = paisesDto[idPais - 1]
		try {
			validarTurno(cliente, paisDto)
			validarFaseRecargaMisiles()
			if (fichas < MISILES) {
				throw ("no hay suficientes fichas")
			}
			validarBloqueo(paisDto)
			paisDto.misiles++
			fichas -= MISILES
			teg.to(cliente.sala).emit("fichas", fichas)
			teg.to(cliente.sala).emit("ponerPais", paisDto)
		} catch (e) {
			console.log(e)
			cliente.emit('jugadaInvalida', e)
		}
	})
	cliente.on('canjear', cartas => {
		try {
			if (jugadores[turno % jugadores.length] != cliente) {
				throw ('no es tu turno')
			}
			validarFaseRecargaMisiles()
			const paises = []
			for (let carta of cartas.paises) {
				paises.push(paisesDto[carta - 1])
			}
			const continentes = []
			for (let carta of cartas.continentes) {
				continentes.push(mazoContinentes[carta - 1])
			}
			const jugadorActual = jugadorDtos[turno % jugadorDtos.length]
			if (jugadorActual.puedeCanjear(paises, continentes)) {
				fichas += jugadorActual.fichasCanje()
				jugadorActual.cantidadCanjes++
				for (let pais of paises) {
					jugadorActual.cartasPais.splice(jugadorActual.cartasPais.indexOf(pais), 1)
				}
				mazoPaisesDto.push(...paises)
				for (let continente of continentes) {
					continente.jugadores.push(jugadorActual.color)
				}
				teg.to(cliente.sala).emit("fichas", fichas)
				cliente.emit("objetivo", jugadorActual)
			} else {
				throw ("no se puede hacer el canje con esas cartas")
			}
		} catch (e) {
			console.log(e)
			cliente.emit('jugadaInvalida', e)
		}
	})
})

function validarTurno(cliente, paisDto) {
	if (jugadores[turno % jugadores.length] != cliente) {
		throw ('no es tu turno')
	}
	if (paisDto && jugadorDtos[turno % jugadorDtos.length].color != paisDto.jugador) {
		throw ('no es tu pais')
	}
	if (cartaGlobal && cartaGlobal.color == jugadorDtos[turno % jugadorDtos.length].color) {
		throw ('estas en descanso')
	}
}

function validarAtaque(paisDtoA, paisDtoD) {
	if (paisDtoA.ejercitos <= 1) {
		throw ('no hay suficiente ejercito')
	}
	return cargaPaises[paisDtoA.id - 1].distancia(cargaPaises[paisDtoD.id - 1])
}

function validarMisil(paisDtoA, paisDtoD) {
	if (paisDtoA.misiles < 1) {
		throw ('No hay misiles')
	}
	return cargaPaises[paisDtoA.id - 1].distancia(cargaPaises[paisDtoD.id - 1])
}

function validarFaseAtaque() {
	if (!faseAtaque) {
		throw ("no se puede atacar ahora")
	}
}

function validarFaseRecargaMisiles() {
	if (!faseRecarga) {
		throw ("no se puede poner fichas ni comprar o vender misiles ahora ni canjear")
	}
}

function validarFaseRecarga() {
	if (!(faseRecarga || fase8 || fase4)) {
		throw ("no se puede poner fichas ahora")
	}
}

function validarFaseReagrupe() {
	if (!(faseReagrupe || captura)) {
		throw ("no se puede trasladar ejercitos ni misiles")
	}
}

function validarBloqueo(paisDto) {
	if (faseRecarga) {
		const limites = []
		for (let limite of paisDto.limites) {
			limites.push(paisesDto[limite - 1])
		}
		if (paisDto.bloqueado(limites)) {
			throw ("el pais esta bloqueado")
		}
	}
}

function desordenar(vector) {
	for (let i = 0; i < vector.length; i++) {
		for (let j = 0; j < vector.length; j++) {
			if (Math.floor(Math.random() * 2) == 0) {
				let aux = vector[i]
				vector[i] = vector[j]
				vector[j] = aux
			}
		}
	}
	return vector
}

http.listen(3000, () => {
	console.log('puerto escucha *:3000')
})