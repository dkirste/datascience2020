const os = require('os')
const dns = require('dns').promises
const { program: optionparser } = require('commander')
const { Kafka } = require('kafkajs')
const mysqlx = require('@mysql/xdevapi');
const MemcachePlus = require('memcache-plus');
const express = require('express')

const app = express()
const cacheTimeSecs = 15
const numberOfProducts = 7

// -------------------------------------------------------
// Command-line options
// -------------------------------------------------------

let options = optionparser
	.storeOptionsAsProperties(true)
	// Web server
	.option('--port <port>', "Web server port", 3000)
	// Kafka options
	.option('--kafka-broker <host:port>', "Kafka bootstrap host:port", "my-cluster-kafka-bootstrap:9092")
	.option('--kafka-topic-tracking <topic>', "Kafka topic to tracking data send to", "cart-data")
	.option('--kafka-client-id < id > ', "Kafka client ID", "tracker-" + Math.floor(Math.random() * 100000))
	// Memcached options
	.option('--memcached-hostname <hostname>', 'Memcached hostname (may resolve to multiple IPs)', 'my-memcached-service')
	.option('--memcached-port <port>', 'Memcached port', 11211)
	.option('--memcached-update-interval <ms>', 'Interval to query DNS for memcached IPs', 5000)
	// Database options
	.option('--mysql-host <host>', 'MySQL host', 'my-app-mysql-service')
	.option('--mysql-port <port>', 'MySQL port', 33060)
	.option('--mysql-schema <db>', 'MySQL Schema/database', 'webshop')
	.option('--mysql-username <username>', 'MySQL username', 'root')
	.option('--mysql-password <password>', 'MySQL password', 'mysecretpw')
	// Misc
	.addHelpCommand()
	.parse()
	.opts()

// -------------------------------------------------------
// Database Configuration
// -------------------------------------------------------

const dbConfig = {
	host: options.mysqlHost,
	port: options.mysqlPort,
	user: options.mysqlUsername,
	password: options.mysqlPassword,
	schema: options.mysqlSchema
};

async function executeQuery(query, data) {
	let session = await mysqlx.getSession(dbConfig);
	return await session.sql(query, data).bind(data).execute()
}

// -------------------------------------------------------
// Memache Configuration
// -------------------------------------------------------

//Connect to the memcached instances
let memcached = null
let memcachedServers = []

async function getMemcachedServersFromDns() {
	try {
		// Query all IP addresses for this hostname
		let queryResult = await dns.lookup(options.memcachedHostname, { all: true })

		// Create IP:Port mappings
		let servers = queryResult.map(el => el.address + ":" + options.memcachedPort)

		// Check if the list of servers has changed
		// and only create a new object if the server list has changed
		if (memcachedServers.sort().toString() !== servers.sort().toString()) {
			console.log("Updated memcached server list to ", servers)
			memcachedServers = servers

			//Disconnect an existing client
			if (memcached)
				await memcached.disconnect()

			memcached = new MemcachePlus(memcachedServers);
		}
	} catch (e) {
		console.log("Unable to get memcache servers", e)
	}
}

//Initially try to connect to the memcached servers, then each 5s update the list
getMemcachedServersFromDns()
setInterval(() => getMemcachedServersFromDns(), options.memcachedUpdateInterval)

//Get data from cache if a cache exists yet
async function getFromCache(key) {
	if (!memcached) {
		console.log(`No memcached instance available, memcachedServers = ${memcachedServers}`)
		return null;
	}
	return await memcached.get(key);
}

// -------------------------------------------------------
// Kafka Configuration
// -------------------------------------------------------

// Kafka connection
const kafka = new Kafka({
	clientId: options.kafkaClientId,
	brokers: [options.kafkaBroker],
	retry: {
		retries: 0
	}
})

const producer = kafka.producer()
// End

// Send tracking message to Kafka
async function sendTrackingMessage(data) {
	//Ensure the producer is connected
	await producer.connect()

	//Send message
	await producer.send({
		topic: options.kafkaTopicTracking,
		messages: [
			{ value: JSON.stringify(data) }
		]
	})
}
// End

// -------------------------------------------------------
// HTML helper to send a response to the client
// -------------------------------------------------------

function sendResponse(res, productCarts, shoppingCart, cachedResult) {
	res.send(`<!DOCTYPE html>
	<html lang<="en">
	<head>
	  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
	  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1.0"/>
	  <title>Best Webshop in the WWW</title>
	
	  <!-- CSS  -->
	  <link rel = "stylesheet" href = "https://fonts.googleapis.com/icon?family=Material+Icons">
   	  <link rel = "stylesheet" href = "https://cdnjs.cloudflare.com/ajax/libs/materialize/0.97.3/css/materialize.min.css">
   	  <script>
		function PushProductToCart(product) {
			fetch("/pushToCart/" + product, {cache: 'no-cache'})
			console.log("Fetching product id " + product)
		}
	</script>
	</head>
	<body>
	  <nav class="light-blue lighten-1" role="navigation">
		<div class="nav-wrapper container">
		  <ul class="right hide-on-med-and-down">
			<li><a href="#">Login</a></li>
		  </ul>
	
		  <ul id="nav-mobile" class="sidenav">
			<li><a href="#">Homepage</a></li>
		  </ul>
		  <a href="#" data-target="nav-mobile" class="sidenav-trigger"><i class="material-icons">menu</i></a>
		</div>
	  </nav>
	  <div class="section no-pad-bot" id="index-banner">
		<div class="container">
		  <br><br>
		  <h1 class="header center blue-text">Webshop for Products</h1>
		  <div class="row center">
			<h5 class="header col s12 light">You have accepted the commercialization of your data. Thank you!</h5>
		  </div>
		  <br><br>
		</div>
	  </div>
	  <div class="container">
		<div class="section">
		
	
		  <!--   Icon Section   -->
		  ${productCarts}
		  <div class="row">
			<div class="col s12 m4">
			  <div class="icon-block">
				<h2 class="center light-blue-text"><i class="material-icons">flash_on</i></h2>
				<h5 class="center">We recommend</h5>
	
				<p class="light">All products you see are curated by our team of experts for it products. It's not any stupid algorithm.</p>
			  </div>
			</div>
	
			<div class="col s12 m4">
			  <div class="icon-block">
				<h2 class="center light-blue-text"><i class="material-icons">group</i></h2>
				<h5 class="center">30 days return policy</h5>
	
				<p class="light">In the event of you not liking the product (nearly impossible), feel free to return it up to 30 days after purchasing.</p>
			  </div>
			</div>
	
			<div class="col s12 m4">
			  <div class="icon-block">
				<h2 class="center light-blue-text"><i class="material-icons">settings</i></h2>
				<h5 class="center">Shopping Cart</h5>
				${shoppingCart}
			  </div>
			</div>
		  </div>
	
		</div>
		<br><br>
	  </div>
	
	  <footer class="page-footer orange">
		<div class="container">
		  <div class="row">
			<div class="col l6 s12">
			  <h5 class="white-text">Why are we the best shop in the world?</h5>
			  <p class="grey-text text-lighten-4">We deliver excellence. We know what you need before you know.</p>
	
	
			</div>
			<div class="col l3 s12">
			  <h5 class="white-text">Settings</h5>
			  <ul>
				<li><a class="white-text" href="#!">Account Details</a></li>
			  </ul>
			</div>
			<div class="col l3 s12">
			  <h5 class="white-text">Connect</h5>
			  <ul>
				<li><a class="white-text" href="#!">Logout</a></li>
			  </ul>
			</div>
		  </div>
		</div>
		<div class="footer-copyright">
		  <div class="container">
		  Made by <a class="orange-text text-lighten-3" href="http://materializecss.com">Materialize</a>
		  </div>
		</div>
	  </footer>
	
	
	  <!--  Scripts-->
	  <script type = "text/javascript" src = "https://code.jquery.com/jquery-2.1.1.min.js"></script>           
   	  <script src = "https://cdnjs.cloudflare.com/ajax/libs/materialize/0.97.3/js/materialize.min.js"></script> 
	  <script src="https://code.jquery.com/jquery-2.1.1.min.js"></script>
	
	  </body>
	</html>
	`)
}

// -------------------------------------------------------
// Start page
// -------------------------------------------------------

// Get list of products (from cache or db)
async function getProducts() {
	const key = 'products'
	let cachedata = await getFromCache(key)

	if (cachedata) {
		console.log(`Cache hit for key=${key}, cachedata = ${cachedata}`)
		return { result: cachedata, cached: true }
	} else {
		console.log(`Cache miss for key=${key}, querying database`)
		let executeResult = await executeQuery("SELECT * FROM products", [])
		let data = executeResult.fetchAll()
		if (data) {
			let result = data.map(row => row)
			console.log(`Got result=${result}, storing in cache`)
			if (memcached)
				await memcached.set(key, result, cacheTimeSecs);
			return { result, cached: false }
		} else {
			throw "No products data found"
		}
	}
}

async function getShoppingCart(maxCount) {
	const query = "SELECT product, count FROM cart ORDER BY count DESC LIMIT ?"
	return (await executeQuery(query, [maxCount]))
		.fetchAll()
		.map(row => ({ product: row[0], count: row[1] }))
}

// Get  products (from db only)

// Return HTML for start page
app.get("/", (req, res) => {
	const productCount = 10;
	Promise.all([getProducts(), getShoppingCart(productCount)]).then(values => {
		const products = values[0]
		const cartContent = values[1]


		const cardContent = products.result
            .map(m => `<div class="col m4">
            <div class="card">
                <div class="card-image">
                    <img src="${m[3]}">
                    <span class="card-title" style="width:100%; background: rgba(0, 0, 0, 0.5);">${m[2]}</span>
                </div>
                <div class="card-content">
                    <p>${m[1]}</p>
                </div>
                <div class="card-action">
                    <a href="javascript: PushProductToCart('${m[0]}');">Buy this article</a>
                </div>
                </div>
            </div>`)
			.join("")
		
		const ShoppingCart = cartContent
          .map(pc => `<p class="light">Product: ${pc.product} Amount: ${pc.count}</p>`)
          .join("\n")
		
		const productCarts = `
		  <div class="row">${cardContent}</div>
		 `
		sendResponse(res, productCarts, ShoppingCart, products.cached)
	})
})

// PushToCart
app.get("/pushToCart/:product", (req, res) => {
	// Send the tracking message to Kafka
	sendTrackingMessage({
		product: req.params["product"],
		timestamp: Math.floor(new Date() / 1000)
	}).then(() => console.log("Sent to kafka"))
		.catch(e => console.log("Error sending to kafka", e))
	res.send(`<h1>Successed!`)
});

// -------------------------------------------------------
// Main method
// -------------------------------------------------------

app.listen(options.port, function () {
	console.log("Node app is running at http://localhost:" + options.port)
});
