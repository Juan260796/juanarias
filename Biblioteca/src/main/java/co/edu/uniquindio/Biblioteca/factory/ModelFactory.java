package co.edu.uniquindio.Biblioteca.factory;

import co.edu.uniquindio.Biblioteca.model.Biblioteca;
import co.edu.uniquindio.Biblioteca.model.Bibliotecario;
import co.edu.uniquindio.Biblioteca.model.Usuario;
import co.edu.uniquindio.Biblioteca.model.Libro;

import java.time.LocalDate;
public class ModelFactory {
    private static ModelFactory instancia;
    private Biblioteca biblioteca;

    private ModelFactory() {
        biblioteca = new Biblioteca();
        inicializarDatos();
    }

    public static ModelFactory getInstance() {
        if (instancia == null) {
            instancia = new ModelFactory();
        }
        return instancia;
    }

    private void inicializarDatos() {
        biblioteca.agregarUsuario(new Usuario("Juan Pérez", "34765"));
        biblioteca.agregarUsuario(new Usuario("María Rodríguez", "89675"));

        biblioteca.agregarLibro(new Libro("Zill", "Ecuaciones diferenciales", "1234789"));
        biblioteca.agregarLibro(new Libro("Cien años de soledad", "Gabriel García Márquez", "2345890"));

        biblioteca.agregarBibliotecario(new Bibliotecario("Arnulfo Arias", "78764"));


        Bibliotecario bibliotecario = biblioteca.getBibliotecarios().get(0);
        Usuario usuario = biblioteca.getUsuarios().get(0);
        Libro libro = biblioteca.getLibros().get(0);

        bibliotecario.gestionarPrestamo(usuario, libro, LocalDate.now().plusDays(14));
    }

    public Biblioteca getBiblioteca() {
        return biblioteca;
    }
    
}

/*public class ModelFactory {
    private static ModelFactory modelFactory;
    private Biblioteca biblioteca;

    private ModelFactory(){
        inicializarDatos();
        simularPrestamo();
    }
    public static ModelFactory getInstance(){
        if(modelFactory==null){
            modelFactory =new ModelFactory();
        }
        return modelFactory;
    }

    private void inicializarDatos(){
        biblioteca = new Biblioteca();
        Bibliotecario bibliotecario1= new Bibliotecario();
        bibliotecario1.setNombre("Arnulfo");
        Usuario usuario1= new Usuario();
        usuario1.setNombre("Natalia");
        Usuario usuario2= new Usuario();
        usuario2.setNombre("Valentina");
        Usuario usuario3= new Usuario();
        usuario3.setNombre("Camilo");
        Libro libro1= new Libro();
        libro1.setTitulo("Calculo Diferencial");
        Libro libro2= new Libro();
        libro2.setTitulo("Algebre Lineal");
        Libro libro3= new Libro();
        libro3.setTitulo("Principios SOLID");
        Libro libro4= new Libro();
        libro4.setTitulo("Calculo Vectorial");
        biblioteca.getListaUsuarios().add(usuario1);
        biblioteca.getListaUsuarios().add(usuario2);
        biblioteca.getListaUsuarios().add(usuario3);
        biblioteca.getListaLibros().add(libro1);
        biblioteca.getListaLibros().add(libro2);
        biblioteca.getListaLibros().add(libro3);
        biblioteca.getListaLibros().add(libro4);
        biblioteca.getListaBibliotecarios().add(bibliotecario1);
    }

    private void simularPrestamo() {
        Usuario usuario = biblioteca.getListaUsuarios().get(0);
        Libro libro = biblioteca.getListaLibros().get(0);
        Bibliotecario bibliotecario = biblioteca.getListaBibliotecarios().get(0);
        bibliotecario.gestionarPrestamo(libro, usuario, LocalDate.now().plusDays(14));
    }*/



