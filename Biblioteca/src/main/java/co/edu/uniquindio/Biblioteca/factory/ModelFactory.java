package co.edu.uniquindio.Biblioteca.factory;

import co.edu.uniquindio.Biblioteca.model.Biblioteca;
import co.edu.uniquindio.Biblioteca.model.Bibliotecario;
import co.edu.uniquindio.Biblioteca.model.Usuario;
import co.edu.uniquindio.Biblioteca.model.Libro;

public class ModelFactory {
    private static ModelFactory modelFactory;
    private Biblioteca biblioteca;

    private ModelFactory(){
        inicializarDatos();
    }
    public static ModelFactory getInstance(){
        if(modelFactory==null){
            modelFactory =new ModelFactory();
        }
        return modelFactory;
    }

    private void inicializarDatos(){
        biblioteca = new Biblioteca();
        Empleado bibliotecario1= new Biblio();
        bibliotecario1.setNombre("Arnulfo");
        Usuario usuario1= new Usuario();
        usuario1.setNombre("Natalia");
        Usuario usuario2= new Usuario();
        usuario2.setNombre("Valentina");
        Usuario usuario3= new Usuario();
        usuario3.setNombre("Camilo");
        Libro libro1= new Libro();
        libro1.setTitulo("Calculo diferencial");
        Libro libro2= new Libro();




        //Propietario propietario1 = new Propietario();
        //        propietario1.setNombre("Pedro");
        //        Propietario propietario2 = new Propietario();
        //        propietario2.setNombre("Ana");
        //        VehiculoCarga vehiculoCarga1 = new VehiculoCarga();
        //        vehiculoCarga1.setPlaca("RRD098");
        //        vehiculoCarga1.setNumeroEjes(5);
        //        VehiculoCarga vehiculoCarga2 = new VehiculoCarga();
        //        vehiculoCarga2.setPlaca("XXX096");
        //        vehiculoCarga2.setNumeroEjes(3);
        //        VehiculoCarga vehiculoCarga3 = new VehiculoCarga();
        //        vehiculoCarga3.setPlaca("77X096");
        //        vehiculoCarga3.setNumeroEjes(5);
        //        propietario1.setVehiculo(vehiculoCarga1);
        //        propietario1.getListaVehiculosAsociados().add(vehiculoCarga2);
        //        propietario1.getListaVehiculosAsociados().add(vehiculoCarga3);
        //        propietario2.setVehiculo(vehiculoCarga2);
        //        empresaTransporte.getListaPropietarios().add(propietario1);
        //        empresaTransporte.getListaPropietarios().add(propietario2);
        //        empresaTransporte.getListaVehiculosCarga().add(vehiculoCarga1);
        //        empresaTransporte.getListaVehiculosCarga().add(vehiculoCarga2);
        //        empresaTransporte.getListaVehiculosCarga().add(vehiculoCarga3);
    }
}
