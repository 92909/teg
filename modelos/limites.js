const mongoose = require('./mongooseTeg').mongoose

const limiteSchema = new mongoose.Schema({
    pais1: Number,
    pais2: Number
})

const Limite = mongoose.model('limites', limiteSchema)

exports.Limite = Limite